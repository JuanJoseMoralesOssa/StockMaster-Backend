import { BindingScope, inject, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { SecurityBindings, UserProfile } from '@loopback/security'
import { Purchase, PurchaseDetails, PurchaseWithTotal } from '../../models'
import {
  PurchaseDetailsRepository,
  PurchaseRepository,
  PurchaseWithTotalRepository,
} from '../../repositories'
import { DetailMutationService } from './detail-mutation.service'
import { TransactionKind } from './transaction-kind.enum'
import {
  WithDetailsCreateInput,
  WithDetailsUpdateInput,
} from './transaction.types'
import { TransactionWithDetailsService } from './transaction-with-details.service'

const PURCHASE_INCLUDE = { include: ['purchase_details'] }

/**
 * Per-kind facade: binds the generic transaction/detail engines to the
 * purchase repositories once, so controllers never wire infrastructure
 * (dataSource, relation factories, TransactionKind, the acting user) themselves.
 * It also resolves the authenticated user id here — the request-scoped boundary
 * — and passes it into the engines so the low-level balance service stays free of
 * request/auth context (audit Finding M5).
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class PurchaseTransactionService {
  constructor(
    @service(TransactionWithDetailsService)
    private readonly transactionWithDetailsService: TransactionWithDetailsService,
    @service(DetailMutationService)
    private readonly detailMutationService: DetailMutationService,
    @repository(PurchaseRepository)
    private readonly purchaseRepository: PurchaseRepository,
    @repository(PurchaseDetailsRepository)
    private readonly purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PurchaseWithTotalRepository)
    private readonly purchaseWithTotalRepository: PurchaseWithTotalRepository,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  private actorId(): number | undefined {
    const id = Number(this.currentUser?.id)
    return Number.isFinite(id) ? id : undefined
  }

  /** Creates the purchase + details atomically and returns the canonical view. */
  async createWithDetails(
    input: WithDetailsCreateInput,
  ): Promise<PurchaseWithTotal> {
    const id = await this.transactionWithDetailsService.createWithDetails<
      Purchase,
      PurchaseDetails
    >(
      {
        date: input.date,
        details: input.details as PurchaseDetails[] | undefined,
      },
      this.purchaseRepository,
      purchaseId => this.purchaseRepository.purchase_details(purchaseId),
      TransactionKind.PURCHASE,
      this.actorId(),
    )
    return this.purchaseWithTotalRepository.findById(id, PURCHASE_INCLUDE)
  }

  async updateWithDetails(
    input: WithDetailsUpdateInput,
  ): Promise<PurchaseWithTotal> {
    await this.transactionWithDetailsService.updateWithDetails<
      Purchase,
      PurchaseDetails
    >(
      {
        id: input.id,
        version: input.version,
        date: input.date,
        details: input.details as PurchaseDetails[] | undefined,
      },
      this.purchaseRepository,
      purchaseId => this.purchaseRepository.purchase_details(purchaseId),
      TransactionKind.PURCHASE,
      this.actorId(),
    )
    return this.purchaseWithTotalRepository.findById(input.id, PURCHASE_INCLUDE)
  }

  async deleteWithDetails(id: number, version?: number): Promise<void> {
    await this.transactionWithDetailsService.deleteWithDetails<
      Purchase,
      PurchaseDetails
    >(
      id,
      version,
      this.purchaseRepository,
      purchaseId => this.purchaseRepository.purchase_details(purchaseId),
      TransactionKind.PURCHASE,
      this.actorId(),
    )
  }

  async createDetail(
    purchaseId: number,
    detail: Partial<PurchaseDetails>,
    parentVersion?: number,
  ): Promise<PurchaseDetails> {
    return this.detailMutationService.createSingleDetail(
      purchaseId,
      detail,
      id => this.purchaseRepository.purchase_details(id),
      this.purchaseRepository.dataSource,
      TransactionKind.PURCHASE,
      parentVersion,
      this.actorId(),
    )
  }

  async updateDetail(
    id: number,
    detail: Partial<PurchaseDetails>,
    parentVersion?: number,
  ): Promise<PurchaseDetails> {
    return this.detailMutationService.updateSingleDetail(
      id,
      detail,
      this.purchaseDetailsRepository,
      TransactionKind.PURCHASE,
      parentVersion,
      this.actorId(),
    )
  }

  async deleteDetail(id: number, parentVersion?: number): Promise<void> {
    await this.detailMutationService.deleteSingleDetail(
      id,
      this.purchaseDetailsRepository,
      TransactionKind.PURCHASE,
      parentVersion,
      this.actorId(),
    )
  }
}
