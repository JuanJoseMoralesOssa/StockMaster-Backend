import { BindingScope, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { Purchase, PurchaseDetails } from '../models'
import { PurchaseRepository } from '../repositories'
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

@injectable({ scope: BindingScope.TRANSIENT })
export class PurchaseTransactionService {
  constructor(
    @service(TransactionWithDetailsService)
    private readonly transactionWithDetailsService: TransactionWithDetailsService,
    @repository(PurchaseRepository)
    private readonly purchaseRepository: PurchaseRepository,
  ) {}

  async createWithDetails(
    input: CreatePurchaseWithDetailsInput,
  ): Promise<Purchase> {
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
  ): Promise<Purchase> {
    return this.transactionWithDetailsService.updateWithDetails<
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

  async deleteWithDetails(id: number): Promise<void> {
    await this.transactionWithDetailsService.deleteWithDetails<
      Purchase,
      PurchaseDetails
    >(
      id,
      this.purchaseRepository,
      purchaseId => this.purchaseRepository.purchase_details(purchaseId),
      TransactionKind.PURCHASE,
    )
  }
}
