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
  param,
  patch,
  post,
  put,
  requestBody,
  response,
} from '@loopback/rest'
import { service } from '@loopback/core'
import { Roles, requireRoles } from '../../../auth'
import {
  normalizePagination,
  paginationConfig,
} from '../../../config/pagination'
import { Pagination, Product } from '../../../models'
import { ProductRepository } from '../../../repositories'
import { ProductService } from '../../../services'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductController {
  constructor(
    @repository(ProductRepository)
    public productRepository: ProductRepository,
    @service(ProductService)
    public productService: ProductService,
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
    // Delegated so a non-zero opening stock writes its Kardex movement
    // atomically with the product row (see ProductService).
    return this.productService.create(product)
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
    @param.query.number('page') page: number = paginationConfig.DEFAULT_PAGE,
    @param.query.number('limit') limit: number = paginationConfig.DEFAULT_LIMIT,
  ): Promise<Pagination<Product>> {
    const pagination = normalizePagination(page, limit)
    const products = await this.productRepository.find({
      ...filter,
      skip: pagination.skip,
      limit: pagination.limit,
    })
    const count = await this.productRepository.count(filter?.where)
    return new Pagination<Product>({
      count: count.count,
      data: products,
      page: pagination.page,
      limit: pagination.limit,
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
    // Delegated: ProductService is the single chokepoint that strips the
    // reconciler-owned `stock` column, so no write path can desync it.
    return this.productService.updateAll(product, where)
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
    // Delegated to the single stock-protection chokepoint (see ProductService).
    return this.productService.updateById(id, product)
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
    // Delegated to the single stock-protection chokepoint (see ProductService).
    return this.productService.replaceById(id, product)
  }

  @del('/products/{id}')
  @response(204, {
    description: 'Product DELETE success',
  })
  async deleteById(@param.path.number('id') id: number): Promise<void> {
    // Delegated: deletion must distinguish a pristine product (only an
    // opening-balance Kardex row) from one with real transaction history, and
    // clean up the opening row atomically (see ProductService).
    await this.productService.deleteById(id)
  }
}
