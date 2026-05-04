import {
  Count,
  CountSchema,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from '@loopback/repository'
import {
  del,
  get,
  getModelSchemaRef,
  HttpErrors,
  param,
  patch,
  post,
  put,
  requestBody,
  response,
} from '@loopback/rest'
import { Pagination, Product } from '../../../models'
import {
  ExpenseDetailsRepository,
  KardexRepository,
  ProductRepository,
  PurchaseDetailsRepository,
} from '../../../repositories'

export class ProductController {
  constructor(
    @repository(ProductRepository)
    public productRepository: ProductRepository,
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(PurchaseDetailsRepository)
    public purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
  ) {}

  @post('/products')
  @response(200, {
    description: 'Product model instance',
    content: { 'application/json': { schema: getModelSchemaRef(Product) } },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    product: Omit<Product, 'id'>,
  ): Promise<Product> {
    return this.productRepository.create(product)
  }

  @get('/products/count')
  @response(200, {
    description: 'Product model count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async count(@param.where(Product) where?: Where<Product>): Promise<Count> {
    return this.productRepository.count(where)
  }

  @get('/products')
  @response(200, {
    description: 'Array of Product model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Product, { includeRelations: true }),
        },
      },
    },
  })
  async find(
    @param.filter(Product) filter?: Filter<Product>,
    @param.query.number('page') page: number = 1,
    @param.query.number('limit') limit: number = 10,
  ): Promise<Pagination<Product>> {
    const products = await this.productRepository.find({
      ...filter,
      skip: (page - 1) * limit,
      limit: limit,
    })
    const count = await this.productRepository.count(filter?.where)
    return new Pagination<Product>({
      count: count.count,
      data: products,
      page: page,
      limit: limit,
    })
  }

  @get('/products/all')
  @response(200, {
    description: 'Array of Product model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Product, { includeRelations: true }),
        },
      },
    },
  })
  async findAll(
    @param.filter(Product) filter?: Filter<Product>,
  ): Promise<Product[]> {
    const newFilter: Filter<Product> = {
      ...(filter ?? {}),
      order: ['name ASC'],
    }
    return this.productRepository.find(newFilter)
  }

  @patch('/products')
  @response(200, {
    description: 'Product PATCH success count',
    content: { 'application/json': { schema: CountSchema } },
  })
  async updateAll(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, { partial: true }),
        },
      },
    })
    product: Product,
    @param.where(Product) where?: Where<Product>,
  ): Promise<Count> {
    return this.productRepository.updateAll(product, where)
  }

  @get('/products/{id}')
  @response(200, {
    description: 'Product model instance',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Product, { includeRelations: true }),
      },
    },
  })
  async findById(
    @param.path.number('id') id: number,
    @param.filter(Product, { exclude: 'where' })
    filter?: FilterExcludingWhere<Product>,
  ): Promise<Product> {
    return this.productRepository.findById(id, filter)
  }
  @patch('/products/{id}')
  @response(200, {
    description: 'Product PATCH success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Product, { includeRelations: true }),
      },
    },
  })
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, { partial: true }),
        },
      },
    })
    product: Partial<Product>,
  ): Promise<Product> {
    await this.productRepository.updateById(id, product)
    return this.productRepository.findById(id, { include: [] })
  }

  @put('/products/{id}')
  @response(200, {
    description: 'Product PUT success',
    content: {
      'application/json': {
        schema: getModelSchemaRef(Product, { includeRelations: true }),
      },
    },
  })
  async replaceById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'ProductReplace',
            exclude: ['id'],
          }),
        },
      },
    })
    product: Omit<Product, 'id'>,
  ): Promise<Product> {
    await this.productRepository.replaceById(id, product)
    return this.productRepository.findById(id, { include: [] })
  }

  @del('/products/{id}')
  @response(204, {
    description: 'Product DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    const product = await this.productRepository.findById(id)
    if (!product) {
      throw new HttpErrors.NotFound(`Product with id ${id} not found`)
    }

    const [expenseDetailsCount, purchaseDetailsCount, kardexCount] =
      await Promise.all([
        this.expenseDetailsRepository.count({ productId: id }),
        this.purchaseDetailsRepository.count({ productId: id }),
        this.kardexRepository.count({ productId: id }),
      ])

    const totalReferences =
      expenseDetailsCount.count + purchaseDetailsCount.count + kardexCount.count

    if (totalReferences > 0) {
      throw new HttpErrors.Conflict(
        'Cannot deactivate product with transaction history',
      )
    }

    await this.productRepository.deleteById(id)
  }
}
