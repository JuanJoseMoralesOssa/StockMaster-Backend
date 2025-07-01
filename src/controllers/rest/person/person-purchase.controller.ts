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
import {Person, Purchase} from '../../../models';
import {PersonRepository} from '../../../repositories';

export class PersonPurchaseController {
  constructor(
    @repository(PersonRepository) protected personRepository: PersonRepository,
  ) { }

  @get('/people/{id}/purchases', {
    responses: {
      '200': {
        description: 'Array of Person has many Purchase through PurchaseDetails',
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
    return this.personRepository.purchases(id).find(filter);
  }

  @post('/people/{id}/purchases', {
    responses: {
      '200': {
        description: 'create a Purchase model instance',
        content: {'application/json': {schema: getModelSchemaRef(Purchase)}},
      },
    },
  })
  async create(
    @param.path.number('id') id: typeof Person.prototype.id,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Purchase, {
            title: 'NewPurchaseInPerson',
            exclude: ['id'],
          }),
        },
      },
    }) purchase: Omit<Purchase, 'id'>,
  ): Promise<Purchase> {
    return this.personRepository.purchases(id).create(purchase);
  }

  @patch('/people/{id}/purchases', {
    responses: {
      '200': {
        description: 'Person.Purchase PATCH success count',
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
    return this.personRepository.purchases(id).patch(purchase, where);
  }

  @del('/people/{id}/purchases', {
    responses: {
      '200': {
        description: 'Person.Purchase DELETE success count',
        content: {'application/json': {schema: CountSchema}},
      },
    },
  })
  async delete(
    @param.path.number('id') id: number,
    @param.query.object('where', getWhereSchemaFor(Purchase)) where?: Where<Purchase>,
  ): Promise<Count> {
    return this.personRepository.purchases(id).delete(where);
  }
}
