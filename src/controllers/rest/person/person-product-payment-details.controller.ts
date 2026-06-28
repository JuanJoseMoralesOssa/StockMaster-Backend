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
import { Person, Product } from '../../../models'
import { PersonRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PersonProductPaymentDetailsController {
  constructor(
    @repository(PersonRepository) protected personRepository: PersonRepository,
  ) {}

  @get('/people/{id}/products-payment-details', {
    responses: {
      '200': {
        description: 'Array of Person has many Product through PaymentDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Product) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Product>,
  ): Promise<Product[]> {
    return this.personRepository.products_payment_details(id).find(filter)
  }

  @post('/people/{id}/products-payment-details', {
    responses: {
      '200': {
        description: 'create a Product model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Product) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Person.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, {
            title: 'NewProductInPerson',
            exclude: ['id'],
          }),
        },
      },
    })
    _product: Omit<Product, 'id'>,
  ): Promise<Product> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /payments/with-details to create payments.',
    )
  }

  @patch('/people/{id}/products-payment-details', {
    responses: {
      '200': {
        description: 'Person.Product PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Product, { partial: true }),
        },
      },
    })
    _product: Partial<Product>,
    @param.query.object('where', getWhereSchemaFor(Product))
    _where?: Where<Product>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /payments/with-details to update payments.',
    )
  }

  @del('/people/{id}/products-payment-details', {
    responses: {
      '200': {
        description: 'Person.Product DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Product))
    _where?: Where<Product>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /payments/{id} to delete payments.',
    )
  }
}
