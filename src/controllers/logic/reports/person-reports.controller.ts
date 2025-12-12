import { repository } from '@loopback/repository'
import { get, HttpErrors, param } from '@loopback/rest'
import {
  Expense,
  ExpenseDetails,
  Person,
  Purchase,
  PurchaseDetails,
} from '../../../models'
import { PersonRepository } from '../../../repositories'

// Definir interfaces para mejor tipado
interface ProductDetail {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
}

enum FilterType {
  DAY = 'day',
  MONTH = 'month',
}

export class PersonReportsController {
  constructor(
    @repository(PersonRepository) protected personRepository: PersonRepository,
  ) {}

  @get('/suppliers/{supplierId}/products/{productId}/details/day')
  async getSupplierProductDetailsByDay(
    @param.path.number('supplierId') supplierId: number,
    @param.path.number('productId') productId: number,
    @param.query.string('day') day: string, // Format: 'YYYY-MM-DD'
  ): Promise<ProductDetail[]> {
    this.validateIds(supplierId, productId)
    this.validateDateFormat(day, FilterType.DAY)
    return this.getProductDetailsBySupplier(
      supplierId,
      productId,
      day,
      FilterType.DAY,
    )
  }

  @get('/suppliers/{supplierId}/products/{productId}/details')
  async getSupplierProductDetailsByMonth(
    @param.path.number('supplierId') supplierId: number,
    @param.path.number('productId') productId: number,
    @param.query.string('month') month: string, // Format: 'YYYY-MM'
  ): Promise<ProductDetail[]> {
    this.validateIds(supplierId, productId)
    this.validateDateFormat(month, FilterType.MONTH)
    return this.getProductDetailsBySupplier(
      supplierId,
      productId,
      month,
      FilterType.MONTH,
    )
  }

  /**
   * Validates supplier and product IDs
   * @param supplierId - ID of the supplier
   * @param productId - ID of the product
   */
  private validateIds(supplierId: number, productId: number): void {
    if (!supplierId || supplierId <= 0) {
      throw new HttpErrors.BadRequest('Invalid supplier ID')
    }

    if (!productId || productId <= 0) {
      throw new HttpErrors.BadRequest('Invalid product ID')
    }
  }

  /**
   * Validates date format based on filter type
   * @param dateValue - Date string to validate
   * @param filterType - Type of filter (day or month)
   */
  private validateDateFormat(dateValue: string, filterType: FilterType): void {
    const dayRegex = /^\d{4}-\d{2}-\d{2}$/ // YYYY-MM-DD
    const monthRegex = /^\d{4}-\d{2}$/ // YYYY-MM

    // Validate date values greater than 0
    const dateParts = dateValue.split('-')
    if (dateParts.some(part => parseInt(part, 10) <= 0)) {
      throw new HttpErrors.BadRequest('Date values must be greater than 0')
    }

    if (filterType === FilterType.DAY && !dayRegex.test(dateValue)) {
      throw new HttpErrors.BadRequest('Invalid day format. Use YYYY-MM-DD')
    }

    if (filterType === FilterType.MONTH && !monthRegex.test(dateValue)) {
      throw new HttpErrors.BadRequest('Invalid month format. Use YYYY-MM')
    }

    // Additional date validation
    if (filterType === FilterType.DAY) {
      const date = new Date(dateValue)
      if (isNaN(date.getTime())) {
        throw new HttpErrors.BadRequest('Invalid date')
      }
    } else {
      const [year, month] = dateParts.map(Number)
      // Month is 0-based in JavaScript Date
      const date = new Date(year, month - 1)
      if (isNaN(date.getTime())) {
        throw new HttpErrors.BadRequest('Invalid month')
      }
    }
  }

  /**
   * Get product details by supplier filtered by date
   * @param supplierId - ID of the supplier
   * @param productId - ID of the product
   * @param dateValue - Date value (day or month)
   * @param filterType - Type of filter (day or month)
   * @returns Sorted list of product details
   */
  private async getProductDetailsBySupplier(
    supplierId: number,
    productId: number,
    dateValue: string,
    filterType: FilterType,
  ): Promise<ProductDetail[]> {
    // Determine date filter condition based on filter type
    const dateFilter =
      filterType === FilterType.DAY
        ? {
            gte: dateValue,
            lt: dateValue,
          }
        : {
            gte: `${dateValue}-01`,
            lt: `${dateValue}-31`,
          }

    // SOLUCIÓN: No limitar los campos y usar relaciones correctas
    const supplier = await this.personRepository.findOne({
      where: { id: supplierId },
      include: [
        {
          relation: 'purchases',
          scope: {
            where: { date: dateFilter },
            include: [
              {
                relation: 'purchase_details', // Asegúrate de que este nombre coincida con la definición del modelo
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
                relation: 'expense_details', // Asegúrate de que este nombre coincida con la definición del modelo
                scope: {
                  fields: { id: false, weight_kg: true },
                  where: { productId },
                },
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

    return this.processCombinedDetails(supplier)
  }

  /**
   * Process and combine purchase and expense details
   * @param supplier - Supplier data with related entities
   * @returns Sorted list of product details
   */
  private processCombinedDetails(supplier: Person): ProductDetail[] {
    const purchaseDetails =
      supplier.purchases?.flatMap(
        (purchase: Purchase) =>
          purchase.purchase_details?.map((detail: PurchaseDetails) => ({
            date: purchase.date,
            weight_kg: detail.weight_kg,
            type: 'Compra' as const,
          })) ?? [],
      ) ?? []

    // Extract expense details
    const expenseDetails =
      supplier.expenses?.flatMap(
        (expense: Expense) =>
          expense.expense_details?.map((detail: ExpenseDetails) => ({
            date: expense.date,
            weight_kg: detail.weight_kg,
            type: 'Gasto' as const,
          })) ?? [],
      ) ?? []

    // Combine and sort
    return [...purchaseDetails, ...expenseDetails].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
  }
}
