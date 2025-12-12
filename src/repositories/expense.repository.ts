import { Getter, inject } from '@loopback/core'
import {
  DefaultCrudRepository,
  HasManyRepositoryFactory,
  HasManyThroughRepositoryFactory,
  repository,
} from '@loopback/repository'
import { MysqlDataSource } from '../datasources'
// import {SqlserverDataSource} from '../datasources';
import {
  Expense,
  ExpenseDetails,
  ExpenseRelations,
  Person,
  Product,
} from '../models'
import { ExpenseDetailsRepository } from './expense-details.repository'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'

export class ExpenseRepository extends DefaultCrudRepository<
  Expense,
  typeof Expense.prototype.id,
  ExpenseRelations
> {
  public readonly expense_details: HasManyRepositoryFactory<
    ExpenseDetails,
    typeof Expense.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    ExpenseDetails,
    typeof Expense.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    ExpenseDetails,
    typeof Expense.prototype.id
  >

  constructor(
    @inject('datasources.mysql') dataSource: MysqlDataSource,
    // @inject('datasources.sqlserver') dataSource: SqlserverDataSource,
    @repository.getter('ExpenseDetailsRepository')
    protected expenseDetailsRepositoryGetter: Getter<ExpenseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(Expense, dataSource)
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
  ): Promise<Expense[]> {
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
        return []
      }
    }

    // Armar el where para Expense
    const expenseWhere: Record<string, unknown> = {}

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

    return this.find({
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
    })
  }
}
