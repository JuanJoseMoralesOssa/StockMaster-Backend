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
  Person,
  Product,
  PurchaseDetails,
  PurchaseWithTotal,
  PurchaseWithTotalRelations,
} from '../models'
import { PersonRepository } from './person.repository'
import { ProductRepository } from './product.repository'
import { PurchaseDetailsRepository } from './purchase-details.repository'

export class PurchaseWithTotalRepository extends DefaultCrudRepository<
  PurchaseWithTotal,
  typeof PurchaseWithTotal.prototype.id,
  PurchaseWithTotalRelations
> {
  public readonly purchase_details: HasManyRepositoryFactory<
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
  >

  public readonly people: HasManyThroughRepositoryFactory<
    Person,
    typeof Person.prototype.id,
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
  >

  public readonly products: HasManyThroughRepositoryFactory<
    Product,
    typeof Product.prototype.id,
    PurchaseDetails,
    typeof PurchaseWithTotal.prototype.id
  >

  constructor(
    @inject('datasources.postgres') dataSource: PostgresDataSource,
    @repository.getter('PurchaseDetailsRepository')
    protected purchaseDetailsRepositoryGetter: Getter<PurchaseDetailsRepository>,
    @repository.getter('PersonRepository')
    protected personRepositoryGetter: Getter<PersonRepository>,
    @repository.getter('ProductRepository')
    protected productRepositoryGetter: Getter<ProductRepository>,
  ) {
    super(PurchaseWithTotal, dataSource)
    this.products = this.createHasManyThroughRepositoryFactoryFor(
      'products',
      productRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('products', this.products.inclusionResolver)
    this.people = this.createHasManyThroughRepositoryFactoryFor(
      'people',
      personRepositoryGetter,
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver('people', this.people.inclusionResolver)
    this.purchase_details = this.createHasManyRepositoryFactoryFor(
      'purchase_details',
      purchaseDetailsRepositoryGetter,
    )
    this.registerInclusionResolver(
      'purchase_details',
      this.purchase_details.inclusionResolver,
    )
  }

  async findFilteredPurchases(
    startDate?: string,
    endDate?: string,
    personId?: number,
    productId?: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: PurchaseWithTotal[]; count: number }> {
    const detailWhere: Record<string, unknown> = {}
    if (personId !== undefined) detailWhere.personId = personId
    if (productId !== undefined) detailWhere.productId = productId

    let purchaseIds: number[] | undefined = undefined

    // Solo buscar purchaseDetails si se aplica algún filtro sobre ellos
    if (personId !== undefined || productId !== undefined) {
      const purchaseDetailsRepo = await this.purchaseDetailsRepositoryGetter()
      const matchingDetails = await purchaseDetailsRepo.find({
        where: detailWhere,
        fields: ['purchaseId'],
      })

      // Extrae IDs únicos
      purchaseIds = [...new Set(matchingDetails.map(d => d.purchaseId))]

      // Si no hay coincidencias, devolver vacío
      if (purchaseIds.length === 0) {
        return { data: [], count: 0 }
      }
    }

    // Armar el where para PurchaseWithTotal
    const purchaseWhere: Where<PurchaseWithTotal> = {}

    // Agregar filtro de fechas solo si se proporcionan
    if (startDate && endDate) {
      purchaseWhere.date = { between: [startDate, endDate] }
    } else if (startDate) {
      purchaseWhere.date = { gte: startDate }
    } else if (endDate) {
      purchaseWhere.date = { lte: endDate }
    }

    if (purchaseIds) {
      purchaseWhere.id = { inq: purchaseIds }
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
        where: purchaseWhere,
        include: [
          {
            relation: 'purchase_details',
            ...(Object.keys(includeScope).length > 0
              ? { scope: includeScope }
              : {}),
          },
        ],
        order: ['date DESC'],
        skip,
        limit: pageSize,
      }),
      this.count(purchaseWhere),
    ])

    return {
      data,
      count: countResult.count,
    }
  }
}
