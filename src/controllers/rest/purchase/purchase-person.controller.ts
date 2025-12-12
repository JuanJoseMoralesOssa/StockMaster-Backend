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
  param,
  patch,
  post,
  requestBody,
} from '@loopback/rest'
import { Person, Purchase } from '../../../models'
import { PurchaseRepository } from '../../../repositories/purchase.repository'

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
    @param.path.number('id') id: typeof Purchase.prototype.id,
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
    person: Omit<Person, 'id'>,
  ): Promise<Person> {
    return this.purchaseRepository.people(id).create(person)
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
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Person, { partial: true }),
        },
      },
    })
    person: Partial<Person>,
    @param.query.object('where', getWhereSchemaFor(Person))
    where?: Where<Person>,
  ): Promise<Count> {
    return this.purchaseRepository.people(id).patch(person, where)
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
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Person))
    where?: Where<Person>,
  ): Promise<Count> {
    return this.purchaseRepository.people(id).delete(where)
  }
}
