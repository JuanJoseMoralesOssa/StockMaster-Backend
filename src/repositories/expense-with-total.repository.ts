import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
  Where,
} from '@loopback/repository'
import { PostgresDataSource } from '../datasources'
import {
  ExpenseDetails,
  ExpenseWithTotal,
  ExpenseWithTotalRelations,
  Person,
  Product,
} from '../models'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class ExpenseWithTotalRepository extends DefaultCrudRepository<
  ExpenseWithTotal,
  typeof ExpenseWithTotal.prototype.id,
  ExpenseWithTotalRelations
> {
  public readonly expense_details: HasManyRepositoryFactory<
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    ExpenseDetails,
    typeof ExpenseWithTotal.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('ExpenseDetailsRepository')
    protected expenseDetailsRepositoryGetter: Getter<ExpenseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(ExpenseWithTotal, dataSource)
    this.products = this.createHasManyThroughRepositoryFactoryFor(
      'products',
      productRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('products', this.products.inclusionResolver)
    this.people = this.createHasManyThroughRepositoryFactoryFor(
      'people',
      personRepositoryGetter,
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('people', this.people.inclusionResolver)
    this.expense_details = this.createHasManyRepositoryFactoryFor(
      'expense_details',
      expenseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'expense_details',
      this.expense_details.inclusionResolver,
    )
  }

  async findFilteredExpenses(
    startDate?: string,
    endDate?: string,
    personId?: number,
    productId?: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: ExpenseWithTotal[]; count: number }> {
    const detailWhere: Record<string, unknown> = {}
    if (personId !== undefined) detailWhere.personId = personId
    if (productId !== undefined) detailWhere.productId = productId

    let expenseIds: number[] | undefined = undefined

    // Solo buscar expenseDetails si se aplica algún filtro sobre ellos
    if (personId !== undefined || productId !== undefined) {
      const expenseDetailsRepo = await this.expenseDetailsRepositoryGetter()
      const matchingDetails = await expenseDetailsRepo.find({
        where: detailWhere,
        fields: ['expenseId'],
      })

      // Extrae IDs únicos
      expenseIds = [...new Set(matchingDetails.map(d => d.expenseId))]

      // Si no hay coincidencias, devolver vacío
      if (expenseIds.length === 0) {
        return { data: [], count: 0 }
      }
    }

    // Armar el where para ExpenseWithTotal
    const expenseWhere: Where<ExpenseWithTotal> = {}

    // Agregar filtro de fechas solo si se proporcionan
    if (startDate && endDate) {
      expenseWhere.date = { between: [startDate, endDate] }
    } else if (startDate) {
      expenseWhere.date = { gte: startDate }
    } else if (endDate) {
      expenseWhere.date = { lte: endDate }
    }

    if (expenseIds) {
      expenseWhere.id = { inq: expenseIds }
    }

    // Armar el scope del include dinámicamente
    const includeScope: Record<string, unknown> = {}
    if (Object.keys(detailWhere).length > 0) {
      includeScope.where = detailWhere
    }

    const currentPage = page && page > 0 ? page : 1
    const pageSize = limit && limit > 0 ? limit : 10
    const skip = (currentPage - 1) * pageSize

    const [data, countResult] = await Promise.all([
      this.find({
        where: expenseWhere,
        include: [
          {
            relation: 'expense_details',
            ...(Object.keys(includeScope).length > 0
              ? { scope: includeScope }
              : {}),
          },
        ],
        order: ['date DESC'],
        skip,
        limit: pageSize,
      }),
      this.count(expenseWhere),
    ])

    return {
      data,
      count: countResult.count,
    }
  }
}
