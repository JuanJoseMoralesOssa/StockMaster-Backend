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
import {Product, Purchase} from '../../../models';
import {ProductRepository} from '../../../repositories';

export class ProductPurchaseController {
  constructor(
    @repository(ProductRepository) protected productRepository: ProductRepository,
  ) { }

  @get('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'Array of Product has many Purchase through PurchaseDetails',
        content: {
          'application/json': {
            schema: {type: 'array', items: getModelSchemaRef(Purchase)},
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Purchase>,
  ): Promise<Purchase[]> {
    return this.productRepository.purchases(id).find(filter);
  }

  @post('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'create a Purchase model instance',
        content: {'application/json': {schema: getModelSchemaRef(Purchase)}},
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'NewPurchaseInProduct',
            exclude: ['id'],
          }),
        },
      },
    }) purchase: Omit<Purchase, 'id'>,
  ): Promise<Purchase> {
    return this.productRepository.purchases(id).create(purchase);
  }

  @patch('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'Product.Purchase PATCH success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {partial: true}),
        },
      },
    })
    purchase: Partial<Purchase>,
    @param.query.object('where', getWhereSchemaFor(Purchase)) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.productRepository.purchases(id).patch(purchase, where);
  }

  @del('/products/{id}/purchases', {
    responses: {
      '200': {
        description: 'Product.Purchase DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Purchase)) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.productRepository.purchases(id).delete(where);
  }
}
