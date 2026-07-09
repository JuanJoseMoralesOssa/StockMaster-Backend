import { BindingScope, inject, injectable, service } from '@loopback/core'
import { Count, repository, Where } from '@loopback/repository'
import { SecurityBindings, UserProfile } from '@loopback/security'
import {
  ConflictError,
  ResourceNotFoundError,
  ValidationError,
} from '../errors'
import { Kardex, KardexOperation, Product } from '../models'
import {
  PaymentDetailsRepository,
  KardexRepository,
  ProductRepository,
  PurchaseDetailsRepository,
} from '../repositories'
import {
  ManualAdjustmentMode,
  BalanceReconciliationService,
} from '../modules/transactions/balance-reconciliation.service'
import {
  extractRows,
  runInTransaction,
} from '../modules/transactions/transaction-execution.utils'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from '../modules/transactions/transaction.types'

/**
 * Owns product creation/deletion so the Kardex stays consistent with the
 * catalog. Creation records an opening balance atomically with the
 * product row, honoring the "balance change ⇒ Kardex row" invariant even at
 * catalog-creation time (audit Finding 2). Deletion distinguishes a pristine
 * product (only an opening-balance row) — which is removable — from one with
 * real transaction history (purchase/payment lines or any non-opening Kardex
 * movement), which is not.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ProductService {
  constructor(
    @repository(ProductRepository)
    private readonly productRepository: ProductRepository,
    @repository(KardexRepository)
    private readonly kardexRepository: KardexRepository,
    @repository(PurchaseDetailsRepository)
    private readonly purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PaymentDetailsRepository)
    private readonly paymentDetailsRepository: PaymentDetailsRepository,
    @service(BalanceReconciliationService)
    private readonly balanceReconciliationService: BalanceReconciliationService,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  private actorId(): number | undefined {
    const id = Number(this.currentUser?.id)
    return Number.isFinite(id) ? id : undefined
  }

  /**
   * `balance` is reconciler-owned: it is kept consistent with the Kardex only by
   * BalanceReconciliationService, so no client write path may set it directly.
   * This is the single chokepoint that enforces that invariant — controllers
   * delegate every Product mutation here and never touch the repository writes,
   * so the rule cannot be bypassed by adding a new endpoint (audit Finding H1).
   */
  private stripProtectedColumns(data: Partial<Product>): Partial<Product> {
    const safe: Partial<Product> = { ...data }
    delete safe.balance
    return safe
  }

  async updateById(id: number, data: Partial<Product>): Promise<Product> {
    await this.productRepository.updateById(
      id,
      this.stripProtectedColumns(data),
    )
    return this.productRepository.findById(id, { include: [] })
  }

  /** PUT replace; still strips `balance` so a replace cannot reset the balance. */
  async replaceById(id: number, data: Partial<Product>): Promise<Product> {
    await this.productRepository.updateById(
      id,
      this.stripProtectedColumns(data),
    )
    return this.productRepository.findById(id, { include: [] })
  }

  async updateAll(
    data: Partial<Product>,
    where?: Where<Product>,
  ): Promise<Count> {
    return this.productRepository.updateAll(
      this.stripProtectedColumns(data),
      where,
    )
  }

  async create(data: Omit<Product, 'id'>): Promise<Product> {
    const dataSource = this.dataSource()

    return runInTransaction(dataSource, async (tx: TransactionOptions) => {
      const product = await this.productRepository.create(data, tx)
      await this.balanceReconciliationService.recordOpeningBalance(
        product.id!,
        data.balance ?? 0,
        tx.transaction,
        this.actorId(),
      )
      return product
    })
  }

  /**
   * Manual inventory adjustment ("ajuste de inventario"): the only user-driven
   * path allowed to change Product.balance outside a purchase/payment. Validates
   * the input here (so the client gets a clean 400) and delegates the atomic
   * balance + Kardex write to BalanceReconciliationService. Returns the created
   * Kardex movement (with its product) so the UI can show it immediately.
   */
  async adjustBalance(
    productId: number,
    input: { mode: ManualAdjustmentMode; value: number; note: string },
  ): Promise<Kardex> {
    if (input.mode !== 'set' && input.mode !== 'delta') {
      throw new ValidationError("Modo de ajuste inválido (use 'set' o 'delta')")
    }

    const value = Number(input.value)
    if (!Number.isFinite(value)) {
      throw new ValidationError('El valor del ajuste debe ser numérico')
    }
    if (input.mode === 'set' && value < 0) {
      throw new ValidationError('El balance real no puede ser negativo')
    }

    const note = (input.note ?? '').trim()
    if (!note) {
      throw new ValidationError('El motivo del ajuste es obligatorio')
    }

    const dataSource = this.dataSource()
    const movement = await runInTransaction(
      dataSource,
      (tx: TransactionOptions) =>
        this.balanceReconciliationService.recordManualAdjustment(
          dataSource,
          tx.transaction,
          productId,
          input.mode,
          value,
          note,
          this.actorId(),
        ),
    )

    // Re-read with the product relation so the UI row is complete (the create
    // inside the transaction returns the bare row without its product).
    return this.kardexRepository.findById(movement.id!, {
      include: [{ relation: 'product' }],
    })
  }

  async deleteById(id: number): Promise<void> {
    const dataSource = this.dataSource()

    await runInTransaction(dataSource, async (tx: TransactionOptions) => {
      // Lock the product row FOR UPDATE first. Every balance mutation updates this
      // same row, so a concurrent purchase/payment create that would give the
      // product history must serialize behind us — the history check below is
      // then made on a stable snapshot, closing the read-then-delete race that a
      // pre-transaction count left open.
      const locked = extractRows(
        await dataSource.execute(
          'SELECT id FROM product WHERE id = $1 FOR UPDATE',
          [id],
          tx,
        ),
      )
      if (locked.length === 0) {
        throw new ResourceNotFoundError(`Product with id ${id} not found`)
      }

      // Real transaction history = purchase/payment lines, or any Kardex row that
      // is not the creation opening balance (movements survive even after the
      // originating document is deleted, since the Kardex is append-only).
      const [paymentDetailsCount, purchaseDetailsCount, movementCount] =
        await Promise.all([
          this.paymentDetailsRepository.count({ productId: id }, tx),
          this.purchaseDetailsRepository.count({ productId: id }, tx),
          this.kardexRepository.count(
            {
              productId: id,
              operation: { neq: KardexOperation.OpeningBalance },
            },
            tx,
          ),
        ])

      if (
        paymentDetailsCount.count +
          purchaseDetailsCount.count +
          movementCount.count >
        0
      ) {
        throw new ConflictError(
          'Cannot deactivate product with transaction history',
        )
      }

      // Pristine product: delete EXACTLY the opening-balance row (not every
      // Kardex row for the product) so the product→Kardex FK does not block the
      // delete, while a stray non-opening movement could never be silently
      // erased. Then remove the product.
      await this.kardexRepository.deleteAll(
        { productId: id, operation: KardexOperation.OpeningBalance },
        tx,
      )
      await this.productRepository.deleteById(id, tx)
    })
  }

  private dataSource(): DataSourceWithTransactions {
    return this.productRepository
      .dataSource as unknown as DataSourceWithTransactions
  }
}
