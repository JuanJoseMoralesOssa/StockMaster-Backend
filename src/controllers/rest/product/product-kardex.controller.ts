import {
  Count,
  CountSchema,
  Filter,
  repository,
  Where,
} from '@loopback/repository'
import {
  del,
  get,
  getModelSchemaRef,
  getWhereSchemaFor,
  HttpErrors,
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Kardex, Product } from '../../../models'
import { ProductRepository } from '../../../repositories'

// Kardex vía producto: solo lectura. Las mutaciones están bloqueadas; el
// kardex lo genera el sistema a través de las operaciones de compra/gasto.
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class ProductKardexController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Array of Product has many Kardex',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Kardex) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Kardex>,
  ): Promise<Kardex[]> {
    return this.productRepository.kardexes(id).find(filter)
  }

  @post('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Kardex) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, {
            title: 'NewKardexInProduct',
            exclude: ['id'],
            optional: ['productId'],
          }),
        },
      },
    })
    _kardex: Omit<Kardex, 'id'>,
  ): Promise<Kardex> {
    throw new HttpErrors.MethodNotAllowed(
      'Creating kardex entries manually is disabled. Entries are system-generated.',
    )
  }

  @patch('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product.Kardex PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, { partial: true }),
        },
      },
    })
    _kardex: Partial<Kardex>,
    @param.query.object('where', getWhereSchemaFor(Kardex))
    _where?: Where<Kardex>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Updating kardex entries is disabled. Entries are append-only.',
    )
  }

  @del('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product.Kardex DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Kardex))
    _where?: Where<Kardex>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Deleting kardex entries is disabled. Entries are append-only.',
    )
  }
}
