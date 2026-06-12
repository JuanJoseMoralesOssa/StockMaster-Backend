import { BindingScope, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { Purchase, PurchaseDetails } from '../models'
import { PurchaseDetailsRepository, PurchaseRepository } from '../repositories'
import { DetailMutationService } from './detail-mutation.service'
import { TransactionKind } from './transaction-kind.enum'
import { TransactionWithDetailsService } from './transaction-with-details.service'

export interface CreatePurchaseWithDetailsInput {
  date: string
  details?: Array<{
    weight_kg: number
    productId: number
    personId: number
  }>
}

export interface UpdatePurchaseWithDetailsInput {
  id: number
  version?: number
  date?: string
  details?: Array<{
    id?: number
    weight_kg: number
    productId: number
    personId: number
  }>
}

/**
 * Per-kind facade: binds the generic transaction/detail engines to the
 * purchase repositories once, so controllers never wire infrastructure
 * (dataSource, relation factories, TransactionKind) themselves.
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
  ) {}

  /** Creates the purchase + details atomically and returns the new id. */
  async createWithDetails(
    input: CreatePurchaseWithDetailsInput,
  ): Promise<number> {
    return this.transactionWithDetailsService.createWithDetails<
      Purchase,
      PurchaseDetails
    >(
      {
        date: input.date,
        details: input.details as PurchaseDetails[] | undefined,
      },
      this.purchaseRepository,
      id => this.purchaseRepository.purchase_details(id),
      TransactionKind.PURCHASE,
    )
  }

  async updateWithDetails(
    input: UpdatePurchaseWithDetailsInput,
  ): Promise<void> {
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
      id => this.purchaseRepository.purchase_details(id),
      TransactionKind.PURCHASE,
    )
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
    )
  }

  async deleteDetail(id: number, parentVersion?: number): Promise<void> {
    await this.detailMutationService.deleteSingleDetail(
      id,
      this.purchaseDetailsRepository,
      TransactionKind.PURCHASE,
      parentVersion,
    )
  }
}
