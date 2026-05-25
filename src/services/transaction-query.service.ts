import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import {
  Expense,
  ExpenseDetails,
  Person,
  Purchase,
  PurchaseDetails,
} from '../models'
import {
  ExpenseDetailsRepository,
  ExpenseRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
  PurchaseRepository,
} from '../repositories'

interface TransactionDetailPersonProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
}

interface TransactionDetailProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
  personId: number // Opcional para incluir información del proveedor
  personName?: string // Opcional para mostrar el nombre del proveedor
}

interface TransactionDetailPerson {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
  productId: number // Opcional para incluir información del proveedor
  personName?: string // Opcional para mostrar el nombre del proveedor
}

type PurchaseDetailWithRelations = PurchaseDetails & {
  purchase?: Pick<Purchase, 'date'>
  person?: Pick<Person, 'name'>
}

type ExpenseDetailWithRelations = ExpenseDetails & {
  expense?: Pick<Expense, 'date'>
  person?: Pick<Person, 'name'>
}

import { injectable, BindingScope } from '@loopback/core'

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
    // Validación de fechas
    if (!startDate || !endDate) {
      throw new HttpErrors.BadRequest('Both startDate and endDate are required')
    }

    // Validar formato de fechas
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new HttpErrors.BadRequest('Invalid date format. Use YYYY-MM-DD')
    }

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
              type: 'Compra' as const,
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
              type: 'Gasto' as const,
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
    // Validación de fechas
    if (!startDate || !endDate) {
      throw new HttpErrors.BadRequest('Both startDate and endDate are required')
    }
    // Validar formato de fechas
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new HttpErrors.BadRequest('Invalid date format. Use YYYY-MM-DD')
    }

    // Verificar que el producto existe
    const product = await this.productRepository.findById(productId)
    if (!product) {
      throw new HttpErrors.NotFound(
        `Producto con ID ${productId} no encontrado`,
      )
    }

    // Construir filtro de fechas
    const dateFilter = {
      between: [startDate, endDate],
    }

    // Obtener todos los detalles de compra para este producto
    const purchaseDetails = await this.purchaseDetailsRepository.find({
      where: { productId },
      include: [
        {
          relation: 'purchase',
          scope: {
            where: {
              date: dateFilter,
            },
          },
        },
        {
          relation: 'person',
        },
      ],
    })

    // Obtener todos los detalles de gasto para este producto
    const expenseDetails = await this.expenseDetailsRepository.find({
      where: { productId },
      include: [
        {
          relation: 'expense',
          scope: {
            where: {
              date: dateFilter,
            },
          },
        },
        {
          relation: 'person',
        },
      ],
    })

    // Procesar los resultados
    const transactions: TransactionDetailProduct[] = []
    const purchaseDetailsWithRelations =
      purchaseDetails as PurchaseDetailWithRelations[]
    const expenseDetailsWithRelations =
      expenseDetails as ExpenseDetailWithRelations[]

    // Procesar detalles de compra - USANDO LAS RELACIONES INCLUIDAS
    for (const detail of purchaseDetailsWithRelations) {
      // Solo procesar si la relación purchase existe (ya filtrada por fecha)
      if (detail.purchase && detail.weight_kg) {
        transactions.push({
          date: detail.purchase.date,
          weight_kg: detail.weight_kg,
          type: 'Compra',
          personId: detail.personId,
          personName: detail.person?.name,
        })
      }
    }

    // Procesar detalles de gasto - USANDO LAS RELACIONES INCLUIDAS
    for (const detail of expenseDetailsWithRelations) {
      // Solo procesar si la relación expense existe (ya filtrada por fecha)
      if (detail.expense && detail.weight_kg) {
        transactions.push({
          date: detail.expense.date,
          weight_kg: detail.weight_kg,
          type: 'Gasto',
          personId: detail.personId,
          personName: detail.person?.name,
        })
      }
    }

    // Ordenar por fecha
    return transactions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }

  async getPersonTransactions(
    personId: number,
    startDate: string,
    endDate: string,
  ): Promise<TransactionDetailPerson[]> {
    // Validación de fechas
    if (!startDate || !endDate) {
      throw new HttpErrors.BadRequest('Both startDate and endDate are required')
    }
    // Validar formato de fechas
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new HttpErrors.BadRequest('Invalid date format. Use YYYY-MM-DD')
    }

    // Verificar que la persona existe
    const person = await this.personRepository.findById(personId)
    if (!person) {
      throw new HttpErrors.NotFound(`Persona con ID ${personId} no encontrada`)
    }

    // Construir filtro de fechas
    const dateFilter = {
      between: [startDate, endDate],
    }

    // Obtener todos los detalles de compra para esta persona con filtro de fecha
    const purchaseDetails = await this.purchaseDetailsRepository.find({
      where: { personId },
      include: [
        {
          relation: 'purchase',
          scope: {
            where: {
              date: dateFilter,
            },
          },
        },
        {
          relation: 'product',
        },
      ],
    })

    // Obtener todos los detalles de gasto para esta persona con filtro de fecha
    const expenseDetails = await this.expenseDetailsRepository.find({
      where: { personId },
      include: [
        {
          relation: 'expense',
          scope: {
            where: {
              date: dateFilter,
            },
          },
        },
        {
          relation: 'product',
        },
      ],
    })

    // Procesar los resultados
    const transactions: TransactionDetailPerson[] = []
    const purchaseDetailsWithRelations =
      purchaseDetails as PurchaseDetailWithRelations[]
    const expenseDetailsWithRelations =
      expenseDetails as ExpenseDetailWithRelations[]

    // Procesar detalles de compra - USANDO LAS RELACIONES INCLUIDAS
    for (const detail of purchaseDetailsWithRelations) {
      // Solo procesar si la relación purchase existe (ya filtrada por fecha)
      if (detail.purchase && detail.weight_kg) {
        transactions.push({
          date: detail.purchase.date,
          weight_kg: detail.weight_kg,
          type: 'Compra',
          productId: detail.productId,
        })
      }
    }

    // Procesar detalles de gasto - USANDO LAS RELACIONES INCLUIDAS
    for (const detail of expenseDetailsWithRelations) {
      // Solo procesar si la relación expense existe (ya filtrada por fecha)
      if (detail.expense && detail.weight_kg) {
        transactions.push({
          date: detail.expense.date,
          weight_kg: detail.weight_kg,
          type: 'Gasto',
          productId: detail.productId,
        })
      }
    }

    // Ordenar por fecha
    return transactions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }

  public async getSupplierProductDetails(
    supplierId: number,
    productId: number,
    startDate: Date,
    endDate: Date,
  ) {
    const supplier = await this.personRepository.findOne({
      where: { id: supplierId },
      include: [
        {
          relation: 'purchases',
          scope: {
            where: { date: { between: [startDate, endDate] } },
            include: [
              {
                relation: 'purchase_details',
                scope: { where: { productId } },
              },
            ],
          },
        },
        {
          relation: 'expenses',
          scope: {
            where: { date: { between: [startDate, endDate] } },
            include: [
              {
                relation: 'expense_details',
                scope: { where: { productId } },
              },
            ],
          },
        },
      ],
    })

    if (!supplier) {
      throw new HttpErrors.NotFound(
        `Proveedor con ID ${supplierId} no encontrado`,
      )
    }

    const purchaseDetails =
      supplier.purchases?.flatMap(
        (purchase: Purchase) =>
          purchase.purchase_details?.map((detail: PurchaseDetails) => ({
            date: purchase.date,
            weight_kg: detail.weight_kg,
            type: 'Compra' as const,
          })) ?? [],
      ) ?? []

    const expenseDetails =
      supplier.expenses?.flatMap(
        (expense: Expense) =>
          expense.expense_details?.map((detail: ExpenseDetails) => ({
            date: expense.date,
            weight_kg: detail.weight_kg,
            type: 'Gasto' as const,
          })) ?? [],
      ) ?? []

    return [...purchaseDetails, ...expenseDetails].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }
}
