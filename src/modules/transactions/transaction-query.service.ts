import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { ResourceNotFoundError } from '../../errors'
import {
  Payment,
  PaymentDetails,
  Person,
  Purchase,
  PurchaseDetails,
  TransactionDetailPerson,
  TransactionDetailPersonProduct,
  TransactionDetailProduct,
} from '../../models'
import {
  PaymentDetailsRepository,
  PaymentRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../../repositories'
import { validateDateRange } from '../../services/date-validation.utils'
import {
  mapPaymentDetailsToRows,
  mapPurchaseDetailsToRows,
  mergeTransactionRowsByDate,
} from './transaction-detail-mapping.utils'
import { TransactionKind } from './transaction-kind.enum'
import { findParentIdsInRange } from './transaction-range.utils'
import { TRANSACTION_TYPE_LABEL } from './transaction-type.const'

type PurchaseDetailWithPerson = PurchaseDetails & {
  purchase?: Pick<Purchase, 'date'>
  person?: Pick<Person, 'name'>
}

type PaymentDetailWithPerson = PaymentDetails & {
  payment?: Pick<Payment, 'date'>
  person?: Pick<Person, 'name'>
}

type PurchaseDetailWithParent = PurchaseDetails & {
  purchase?: Pick<Purchase, 'date'>
}

type PaymentDetailWithParent = PaymentDetails & {
  payment?: Pick<Payment, 'date'>
}

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionQueryService {
  constructor(
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PaymentDetailsRepository)
    protected paymentDetailsRepository: PaymentDetailsRepository,
    @repository(PersonRepository)
    protected personRepository: PersonRepository,
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
    @repository(PaymentRepository)
    protected paymentRepository: PaymentRepository,
  ) {}

  async getPersonProductTransactions(
    personId: number,
    productId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailPersonProduct[]> {
    validateDateRange(startDate, endDate)

    const dateFilter = {
      between: [startDate, endDate],
    }

    const person = await this.personRepository.findOne({
      where: { id: personId },
      include: [
        {
          relation: 'purchases',
          scope: {
            where: { date: dateFilter },
            include: [
              {
                relation: 'purchase_details',
                scope: {
                  where: { productId },
                },
              },
            ],
          },
        },
        {
          relation: 'payments',
          scope: {
            where: { date: dateFilter },
            include: [
              {
                relation: 'payment_details',
                scope: {
                  where: { productId },
                },
              },
            ],
          },
        },
      ],
    })

    if (!person) {
      throw new ResourceNotFoundError(
        `Persona con ID ${personId} no encontrada`,
      )
    }

    return this.processTransactions(person, productId)
  }

  private processTransactions(
    person: Person,
    productId: number,
  ): TransactionDetailPersonProduct[] {
    const purchaseTransactions =
      person.purchases?.flatMap(
        (purchase: Purchase) =>
          purchase.purchase_details
            ?.filter(
              (detail: PurchaseDetails) => detail.productId === productId,
            )
            .map((detail: PurchaseDetails) => ({
              date: purchase.date,
              weight_kg: detail.weight_kg,
              type: TRANSACTION_TYPE_LABEL[TransactionKind.PURCHASE],
            })) ?? [],
      ) || []

    const paymentTransactions =
      person.payments?.flatMap(
        (payment: Payment) =>
          payment.payment_details
            ?.filter((detail: PaymentDetails) => detail.productId === productId)
            .map((detail: PaymentDetails) => ({
              date: payment.date,
              weight_kg: detail.weight_kg,
              type: TRANSACTION_TYPE_LABEL[TransactionKind.PAYMENT],
            })) || [],
      ) || []

    return [...purchaseTransactions, ...paymentTransactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }

  async getProductTransactions(
    productId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailProduct[]> {
    validateDateRange(startDate, endDate)

    await this.ensureProductExists(productId)

    const [purchaseIds, paymentIds] = await Promise.all([
      this.getPurchaseIdsInRange(startDate, endDate),
      this.getPaymentIdsInRange(startDate, endDate),
    ])

    const [purchaseDetails, paymentDetails] = await Promise.all([
      purchaseIds.length > 0
        ? this.purchaseDetailsRepository.find({
            where: { productId, purchaseId: { inq: purchaseIds } },
            include: [{ relation: 'purchase' }, { relation: 'person' }],
          })
        : Promise.resolve([]),
      paymentIds.length > 0
        ? this.paymentDetailsRepository.find({
            where: { productId, paymentId: { inq: paymentIds } },
            include: [{ relation: 'payment' }, { relation: 'person' }],
          })
        : Promise.resolve([]),
    ])

    const purchaseRows = mapPurchaseDetailsToRows(
      purchaseDetails as PurchaseDetailWithPerson[],
      detail => ({
        personId: detail.personId,
        personName: detail.person?.name,
      }),
    )
    const paymentRows = mapPaymentDetailsToRows(
      paymentDetails as PaymentDetailWithPerson[],
      detail => ({
        personId: detail.personId,
        personName: detail.person?.name,
      }),
    )

    return mergeTransactionRowsByDate(purchaseRows, paymentRows)
  }

  async getPersonTransactions(
    personId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailPerson[]> {
    validateDateRange(startDate, endDate)

    await this.ensurePersonExists(personId)

    const [purchaseIds, paymentIds] = await Promise.all([
      this.getPurchaseIdsInRange(startDate, endDate),
      this.getPaymentIdsInRange(startDate, endDate),
    ])

    const [purchaseDetails, paymentDetails] = await Promise.all([
      purchaseIds.length > 0
        ? this.purchaseDetailsRepository.find({
            where: { personId, purchaseId: { inq: purchaseIds } },
            include: [{ relation: 'purchase' }, { relation: 'product' }],
          })
        : Promise.resolve([]),
      paymentIds.length > 0
        ? this.paymentDetailsRepository.find({
            where: { personId, paymentId: { inq: paymentIds } },
            include: [{ relation: 'payment' }, { relation: 'product' }],
          })
        : Promise.resolve([]),
    ])

    const purchaseRows = mapPurchaseDetailsToRows(
      purchaseDetails as PurchaseDetailWithParent[],
      detail => ({ productId: detail.productId }),
    )
    const paymentRows = mapPaymentDetailsToRows(
      paymentDetails as PaymentDetailWithParent[],
      detail => ({ productId: detail.productId }),
    )

    return mergeTransactionRowsByDate(purchaseRows, paymentRows)
  }

  private async ensurePersonExists(personId: number): Promise<void> {
    const found = await this.personRepository.exists(personId)
    if (!found) {
      throw new ResourceNotFoundError(
        `Persona con ID ${personId} no encontrada`,
      )
    }
  }

  private async ensureProductExists(productId: number): Promise<void> {
    const found = await this.productRepository.exists(productId)
    if (!found) {
      throw new ResourceNotFoundError(
        `Producto con ID ${productId} no encontrado`,
      )
    }
  }

  private getPurchaseIdsInRange(
    startDate: string,
    endDate: string,
  ): Promise<number[]> {
    return findParentIdsInRange(this.purchaseRepository, startDate, endDate)
  }

  private getPaymentIdsInRange(
    startDate: string,
    endDate: string,
  ): Promise<number[]> {
    return findParentIdsInRange(this.paymentRepository, startDate, endDate)
  }
}
