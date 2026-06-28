import { BindingScope, inject, injectable, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import { SecurityBindings, UserProfile } from '@loopback/security'
import { Payment, PaymentDetails, PaymentWithTotal } from '../models'
import {
  PaymentDetailsRepository,
  PaymentRepository,
  PaymentWithTotalRepository,
} from '../repositories'
import { DetailMutationService } from './detail-mutation.service'
import { TransactionKind } from './transaction-kind.enum'
import {
  WithDetailsCreateInput,
  WithDetailsUpdateInput,
} from './transaction.types'
import { TransactionWithDetailsService } from './transaction-with-details.service'

const PAYMENT_INCLUDE = { include: ['payment_details'] }

/**
 * Per-kind facade: binds the generic transaction/detail engines to the
 * payment repositories once, so controllers never wire infrastructure
 * (dataSource, relation factories, TransactionKind, the acting user) themselves.
 * It also resolves the authenticated user id here — the request-scoped boundary
 * — and passes it into the engines so the low-level balance service stays free of
 * request/auth context (audit Finding M5).
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class PaymentTransactionService {
  constructor(
    @service(TransactionWithDetailsService)
    private readonly transactionWithDetailsService: TransactionWithDetailsService,
    @service(DetailMutationService)
    private readonly detailMutationService: DetailMutationService,
    @repository(PaymentRepository)
    private readonly paymentRepository: PaymentRepository,
    @repository(PaymentDetailsRepository)
    private readonly paymentDetailsRepository: PaymentDetailsRepository,
    @repository(PaymentWithTotalRepository)
    private readonly paymentWithTotalRepository: PaymentWithTotalRepository,
    @inject(SecurityBindings.USER, { optional: true })
    private readonly currentUser?: UserProfile,
  ) {}

  private actorId(): number | undefined {
    const id = Number(this.currentUser?.id)
    return Number.isFinite(id) ? id : undefined
  }

  /** Creates the payment + details atomically and returns the canonical view. */
  async createWithDetails(
    input: WithDetailsCreateInput,
  ): Promise<PaymentWithTotal> {
    const id = await this.transactionWithDetailsService.createWithDetails<
      Payment,
      PaymentDetails
    >(
      {
        date: input.date,
        details: input.details as PaymentDetails[] | undefined,
      },
      this.paymentRepository,
      paymentId => this.paymentRepository.payment_details(paymentId),
      TransactionKind.PAYMENT,
      this.actorId(),
    )
    return this.paymentWithTotalRepository.findById(id, PAYMENT_INCLUDE)
  }

  async updateWithDetails(
    input: WithDetailsUpdateInput,
  ): Promise<PaymentWithTotal> {
    await this.transactionWithDetailsService.updateWithDetails<
      Payment,
      PaymentDetails
    >(
      {
        id: input.id,
        version: input.version,
        date: input.date,
        details: input.details as PaymentDetails[] | undefined,
      },
      this.paymentRepository,
      paymentId => this.paymentRepository.payment_details(paymentId),
      TransactionKind.PAYMENT,
      this.actorId(),
    )
    return this.paymentWithTotalRepository.findById(input.id, PAYMENT_INCLUDE)
  }

  async deleteWithDetails(id: number, version?: number): Promise<void> {
    await this.transactionWithDetailsService.deleteWithDetails<
      Payment,
      PaymentDetails
    >(
      id,
      version,
      this.paymentRepository,
      paymentId => this.paymentRepository.payment_details(paymentId),
      TransactionKind.PAYMENT,
      this.actorId(),
    )
  }

  async createDetail(
    paymentId: number,
    detail: Partial<PaymentDetails>,
    parentVersion?: number,
  ): Promise<PaymentDetails> {
    return this.detailMutationService.createSingleDetail(
      paymentId,
      detail,
      id => this.paymentRepository.payment_details(id),
      this.paymentRepository.dataSource,
      TransactionKind.PAYMENT,
      parentVersion,
      this.actorId(),
    )
  }

  async updateDetail(
    id: number,
    detail: Partial<PaymentDetails>,
    parentVersion?: number,
  ): Promise<PaymentDetails> {
    return this.detailMutationService.updateSingleDetail(
      id,
      detail,
      this.paymentDetailsRepository,
      TransactionKind.PAYMENT,
      parentVersion,
      this.actorId(),
    )
  }

  async deleteDetail(id: number, parentVersion?: number): Promise<void> {
    await this.detailMutationService.deleteSingleDetail(
      id,
      this.paymentDetailsRepository,
      TransactionKind.PAYMENT,
      parentVersion,
      this.actorId(),
    )
  }
}
