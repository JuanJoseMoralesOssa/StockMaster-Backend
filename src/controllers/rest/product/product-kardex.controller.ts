import {
  Count,
  CountSchema,
  Filter,
  repository,
  Where,
} from '@loopback/repository';
import {
  del,
  get,
  getModelSchemaRef,
  getWhereSchemaFor,
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest';
import {Kardex, Product} from '../../../models';
import {ProductRepository} from '../../../repositories';

export class ProductKardexController {
  constructor(
    @repository(ProductRepository) protected productRepository: ProductRepository,
  ) { }

  @get('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Array of Product has many Kardex',
        content: {
          'application/json': {
            schema: {type: 'array', items: getModelSchemaRef(Kardex)},
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Kardex>,
  ): Promise<Kardex[]> {
    return this.productRepository.kardexes(id).find(filter);
  }

  @post('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product model instance',
        content: {'application/json': {schema: getModelSchemaRef(Kardex)}},
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, {
            title: 'NewKardexInProduct',
            exclude: ['id'],
            optional: ['productId']
          }),
        },
      },
    }) kardex: Omit<Kardex, 'id'>,
  ): Promise<Kardex> {
    return this.productRepository.kardexes(id).create(kardex);
  }

  @patch('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product.Kardex PATCH success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Kardex, {partial: true}),
        },
      },
    })
    kardex: Partial<Kardex>,
    @param.query.object('where', getWhereSchemaFor(Kardex)) where?: Where<Kardex>,
  ): Promise<Count> {
    return this.productRepository.kardexes(id).patch(kardex, where);
  }

  @del('/products/{id}/kardexes', {
    responses: {
      '200': {
        description: 'Product.Kardex DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Kardex)) where?: Where<Kardex>,
  ): Promise<Count> {
    return this.productRepository.kardexes(id).delete(where);
  }
}
