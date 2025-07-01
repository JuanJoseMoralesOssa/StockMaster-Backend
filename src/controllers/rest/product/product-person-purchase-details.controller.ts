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
import {Person, Product} from '../../../models';
import {ProductRepository} from '../../../repositories';

export class ProductPersonPurchaseDetailsController {
  constructor(
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) { }

  @get('/products/{id}/people-purchase-details', {
    responses: {
      '200': {
        description: 'Array of Product has many Person through PurchaseDetails',
        content: {
          'application/json': {
            schema: {type: 'array', items: getModelSchemaRef(Person)},
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Person>,
  ): Promise<Person[]> {
    return this.productRepository.people_purchase_details(id).find(filter);
  }

  @post('/products/{id}/people-purchase-details', {
    responses: {
      '200': {
        description: 'create a Person model instance',
        content: {'application/json': {schema: getModelSchemaRef(Person)}},
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Product.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPersonInProduct',
            exclude: ['id'],
          }),
        },
      },
    })
    person: Omit<Person, 'id'>,
  ): Promise<Person> {
    return this.productRepository.people_purchase_details(id).create(person);
  }

  @patch('/products/{id}/people-purchase-details', {
    responses: {
      '200': {
        description: 'Product.Person PATCH success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async patch(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {partial: true}),
        },
      },
    })
    person: Partial<Person>,
    @param.query.object('where', getWhereSchemaFor(Person))
    where?: Where<Person>,
  ): Promise<Count> {
    return this.productRepository
      .people_purchase_details(id)
      .patch(person, where);
  }

  @del('/products/{id}/people-purchase-details', {
    responses: {
      '200': {
        description: 'Product.Person DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Person))
    where?: Where<Person>,
  ): Promise<Count> {
    return this.productRepository.people_purchase_details(id).delete(where);
  }
}
