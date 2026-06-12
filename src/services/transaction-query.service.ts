import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import {
  Expense,
  ExpenseDetails,
  Person,
  Purchase,
  PurchaseDetails,
  TransactionDetailPerson,
  TransactionDetailPersonProduct,
  TransactionDetailProduct,
} from '../models'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../repositories'
import { validateDateRange } from './date-validation.utils'
import { TransactionKind } from './transaction-kind.enum'
import { findParentIdsInRange } from './transaction-range.utils'
import { TRANSACTION_TYPE_LABEL } from './transaction-type.const'

type PurchaseDetailWithRelations = PurchaseDetails & {
  purchase?: Pick<Purchase, 'date'>
  person?: Pick<Person, 'name'>
}

type ExpenseDetailWithRelations = ExpenseDetails & {
  expense?: Pick<Expense, 'date'>
  person?: Pick<Person, 'name'>
}

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionQueryService {
  constructor(
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(ExpenseDetailsRepository)
    protected expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(PersonRepository)
    protected personRepository: PersonRepository,
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
    @repository(ExpenseRepository)
    protected expenseRepository: ExpenseRepository,
  ) {}

  async getPersonProductTransactions(
    personId: number,
    productId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailPersonProduct[]> {
    validateDateRange(startDate, endDate)

    // Construir filtro de fechas
    const dateFilter = {
      between: [startDate, endDate],
    }

    // Buscar persona con sus compras y gastos
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
          relation: 'expenses',
          scope: {
            where: { date: dateFilter },
            include: [
              {
                relation: 'expense_details',
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
      throw new HttpErrors.NotFound(`Persona con ID ${personId} no encontrada`)
    }

    return this.processTransactions(person, productId)
  }

  private processTransactions(
    person: Person,
    productId: number,
  ): TransactionDetailPersonProduct[] {
    // Extraer detalles de compras
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

    // Extraer detalles de gastos
    const expenseTransactions =
      person.expenses?.flatMap(
        (expense: Expense) =>
          expense.expense_details
            ?.filter((detail: ExpenseDetails) => detail.productId === productId)
            .map((detail: ExpenseDetails) => ({
              date: expense.date,
              weight_kg: detail.weight_kg,
              type: TRANSACTION_TYPE_LABEL[TransactionKind.EXPENSE],
            })) || [],
      ) || []

    // Combinar y ordenar por fecha
    return [...purchaseTransactions, ...expenseTransactions].sort(
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

    const [purchaseIds, expenseIds] = await Promise.all([
      this.getPurchaseIdsInRange(startDate, endDate),
      this.getExpenseIdsInRange(startDate, endDate),
    ])

    const [purchaseDetails, expenseDetails] = await Promise.all([
      purchaseIds.length > 0
        ? this.purchaseDetailsRepository.find({
            where: { productId, purchaseId: { inq: purchaseIds } },
            include: [{ relation: 'purchase' }, { relation: 'person' }],
          })
        : Promise.resolve([]),
      expenseIds.length > 0
        ? this.expenseDetailsRepository.find({
            where: { productId, expenseId: { inq: expenseIds } },
            include: [{ relation: 'expense' }, { relation: 'person' }],
          })
        : Promise.resolve([]),
    ])

    const transactions: TransactionDetailProduct[] = []
    const purchaseDetailsWithRelations =
      purchaseDetails as PurchaseDetailWithRelations[]
    const expenseDetailsWithRelations =
      expenseDetails as ExpenseDetailWithRelations[]

    for (const detail of purchaseDetailsWithRelations) {
      if (detail.purchase && detail.weight_kg) {
        transactions.push({
          date: detail.purchase.date,
          weight_kg: detail.weight_kg,
          type: TRANSACTION_TYPE_LABEL[TransactionKind.PURCHASE],
          personId: detail.personId,
          personName: detail.person?.name,
        })
      }
    }

    for (const detail of expenseDetailsWithRelations) {
      if (detail.expense && detail.weight_kg) {
        transactions.push({
          date: detail.expense.date,
          weight_kg: detail.weight_kg,
          type: TRANSACTION_TYPE_LABEL[TransactionKind.EXPENSE],
          personId: detail.personId,
          personName: detail.person?.name,
        })
      }
    }

    return transactions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }

  async getPersonTransactions(
    personId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailPerson[]> {
    validateDateRange(startDate, endDate)

    await this.ensurePersonExists(personId)

    const [purchaseIds, expenseIds] = await Promise.all([
      this.getPurchaseIdsInRange(startDate, endDate),
      this.getExpenseIdsInRange(startDate, endDate),
    ])

    const [purchaseDetails, expenseDetails] = await Promise.all([
      purchaseIds.length > 0
        ? this.purchaseDetailsRepository.find({
            where: { personId, purchaseId: { inq: purchaseIds } },
            include: [{ relation: 'purchase' }, { relation: 'product' }],
          })
        : Promise.resolve([]),
      expenseIds.length > 0
        ? this.expenseDetailsRepository.find({
            where: { personId, expenseId: { inq: expenseIds } },
            include: [{ relation: 'expense' }, { relation: 'product' }],
          })
        : Promise.resolve([]),
    ])

    const transactions: TransactionDetailPerson[] = []
    const purchaseDetailsWithRelations =
      purchaseDetails as PurchaseDetailWithRelations[]
    const expenseDetailsWithRelations =
      expenseDetails as ExpenseDetailWithRelations[]

    for (const detail of purchaseDetailsWithRelations) {
      if (detail.purchase && detail.weight_kg) {
        transactions.push({
          date: detail.purchase.date,
          weight_kg: detail.weight_kg,
          type: TRANSACTION_TYPE_LABEL[TransactionKind.PURCHASE],
          productId: detail.productId,
        })
      }
    }

    for (const detail of expenseDetailsWithRelations) {
      if (detail.expense && detail.weight_kg) {
        transactions.push({
          date: detail.expense.date,
          weight_kg: detail.weight_kg,
          type: TRANSACTION_TYPE_LABEL[TransactionKind.EXPENSE],
          productId: detail.productId,
        })
      }
    }

    return transactions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }

  private async ensurePersonExists(personId: number): Promise<void> {
    const person = await this.personRepository.findById(personId)
    if (!person) {
      throw new HttpErrors.NotFound(`Persona con ID ${personId} no encontrada`)
    }
  }

  private async ensureProductExists(productId: number): Promise<void> {
    const product = await this.productRepository.findById(productId)
    if (!product) {
      throw new HttpErrors.NotFound(
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

  private getExpenseIdsInRange(
    startDate: string,
    endDate: string,
  ): Promise<number[]> {
    return findParentIdsInRange(this.expenseRepository, startDate, endDate)
  }
}
