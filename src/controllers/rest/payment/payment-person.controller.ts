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
import { Payment, Person } from '../../../models'
import { PaymentRepository } from '../../../repositories'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PaymentPersonController {
  constructor(
    @repository(PaymentRepository)
    protected paymentRepository: PaymentRepository,
  ) {}

  @get('/payments/{id}/people', {
    responses: {
      '200': {
        description: 'Array of Payment has many Person through PaymentDetails',
        content: {
          'application/json': {
            schema: { type: 'array', items: getModelSchemaRef(Person) },
          },
        },
      },
    },
  })
  async find(
    @param.path.number('id') id: number,
    @param.query.object('filter') filter?: Filter<Person>,
  ): Promise<Person[]> {
    return this.paymentRepository.people(id).find(filter)
  }

  @post('/payments/{id}/people', {
    responses: {
      '200': {
        description: 'create a Person model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Person) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Payment.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPersonInPayment',
            exclude: ['id'],
          }),
        },
      },
    })
    _person: Omit<Person, 'id'>,
  ): Promise<Person> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /payments/with-details to create payments.',
    )
  }

  @patch('/payments/{id}/people', {
    responses: {
      '200': {
        description: 'Payment.Person PATCH success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async patch(
    @param.path.number('id') _id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, { partial: true }),
        },
      },
    })
    _person: Partial<Person>,
    @param.query.object('where', getWhereSchemaFor(Person))
    _where?: Where<Person>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use PUT /payments/with-details to update payments.',
    )
  }

  @del('/payments/{id}/people', {
    responses: {
      '200': {
        description: 'Payment.Person DELETE success count',
        content: { 'application/json': { schema: CountSchema } },
      },
    },
  })
  async delete(
    @param.path.number('id') _id: number,
    @param.query.object('where', getWhereSchemaFor(Person))
    _where?: Where<Person>,
  ): Promise<Count> {
    throw new HttpErrors.MethodNotAllowed(
      'Use DELETE /payments/{id} to delete payments.',
    )
  }
}
