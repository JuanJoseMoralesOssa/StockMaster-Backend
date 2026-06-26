import { BindingScope, inject, injectable, service } from '@loopback/core'
import { Count, repository, Where } from '@loopback/repository'
import { SecurityBindings, UserProfile } from '@loopback/security'
import { ConflictError, ResourceNotFoundError } from '../errors'
import { KardexOperation, Product } from '../models'
import {
  ExpenseDetailsRepository,
  KardexRepository,
  ProductRepository,
  PurchaseDetailsRepository,
} from '../repositories'
import { StockReconciliationService } from './stock-reconciliation.service'
import { extractRows, runInTransaction } from './transaction-execution.utils'
import {
  DataSourceWithTransactions,
  TransactionOptions,
} from './transaction.types'

/**
 * Owns product creation/deletion so the Kardex stays consistent with the
 * catalog. Creation records an opening stock balance atomically with the
 * product row, honoring the "stock change ⇒ Kardex row" invariant even at
 * catalog-creation time (audit Finding 2). Deletion distinguishes a pristine
 * product (only an opening-balance row) — which is removable — from one with
 * real transaction history (purchase/expense lines or any non-opening Kardex
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
    @repository(ExpenseDetailsRepository)
    private readonly expenseDetailsRepository: ExpenseDetailsRepository,
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  private actorId(): number | undefined {
    const id = Number(this.currentUser?.id)
    return Number.isFinite(id) ? id : undefined
  }

  /**
   * `stock` is reconciler-owned: it is kept consistent with the Kardex only by
   * StockReconciliationService, so no client write path may set it directly.
   * This is the single chokepoint that enforces that invariant — controllers
   * delegate every Product mutation here and never touch the repository writes,
   * so the rule cannot be bypassed by adding a new endpoint (audit Finding H1).
   */
  private stripProtectedColumns(data: Partial<Product>): Partial<Product> {
    const safe: Partial<Product> = { ...data }
    delete safe.stock
    return safe
  }

  async updateById(id: number, data: Partial<Product>): Promise<Product> {
    await this.productRepository.updateById(
      id,
      this.stripProtectedColumns(data),
    )
    return this.productRepository.findById(id, { include: [] })
  }

  /** PUT replace; still strips `stock` so a replace cannot reset the balance. */
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
      await this.stockReconciliationService.recordOpeningBalance(
        product.id!,
        data.stock ?? 0,
        tx.transaction,
        this.actorId(),
      )
      return product
    })
  }

  async deleteById(id: number): Promise<void> {
    const dataSource = this.dataSource()

    await runInTransaction(dataSource, async (tx: TransactionOptions) => {
      // Lock the product row FOR UPDATE first. Every stock mutation updates this
      // same row, so a concurrent purchase/expense create that would give the
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

      // Real transaction history = purchase/expense lines, or any Kardex row that
      // is not the creation opening balance (movements survive even after the
      // originating document is deleted, since the Kardex is append-only).
      const [expenseDetailsCount, purchaseDetailsCount, movementCount] =
        await Promise.all([
          this.expenseDetailsRepository.count({ productId: id }, tx),
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
        expenseDetailsCount.count +
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
