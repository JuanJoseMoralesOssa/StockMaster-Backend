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
import { Person, Purchase } from '../../../models'
import { PurchaseRepository } from '../../../repositories/purchase.repository'

@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class PurchasePersonController {
  constructor(
    @repository(PurchaseRepository)
    protected purchaseRepository: PurchaseRepository,
  ) {}

  @get('/purchases/{id}/people', {
    responses: {
      '200': {
        description:
          'Array of Purchase has many Person through PurchaseDetails',
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
    return this.purchaseRepository.people(id).find(filter)
  }

  @post('/purchases/{id}/people', {
    responses: {
      '200': {
        description: 'create a Person model instance',
        content: { 'application/json': { schema: getModelSchemaRef(Person) } },
      },
    },
  })
  async create(
    @param.path.number('id') _id: typeof Purchase.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, {
            title: 'NewPersonInPurchase',
            exclude: ['id'],
          }),
        },
      },
    })
    _person: Omit<Person, 'id'>,
  ): Promise<Person> {
    throw new HttpErrors.MethodNotAllowed(
      'Use POST /purchases/with-details to create purchases.',
    )
  }

  @patch('/purchases/{id}/people', {
    responses: {
      '200': {
        description: 'Purchase.Person PATCH success count',
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
      'Use PUT /purchases/with-details to update purchases.',
    )
  }

  @del('/purchases/{id}/people', {
    responses: {
      '200': {
        description: 'Purchase.Person DELETE success count',
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
      'Use DELETE /purchases/{id} to delete purchases.',
    )
  }
}
