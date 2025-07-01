import {
  repository,
} from '@loopback/repository';
import {
  get,
  getModelSchemaRef,
  param,
} from '@loopback/rest';
import {ExpenseDetails, Product} from '../../../models';
import {ExpenseDetailsRepository} from '../../../repositories';

export class ExpenseDetailsProductController {
  constructor(
    @repository(ExpenseDetailsRepository)
    public expenseDetailsRepository: ExpenseDetailsRepository,
  ) { }

  @get('/expense-details/{id}/product', {
    responses: {
      '200': {
        description: 'Product belonging to ExpenseDetails',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Product),
          },
        },
      },
    },
  })
  async getProduct(
    @param.path.number('id') id: typeof ExpenseDetails.prototype.id,
  ): Promise<Product> {
    return this.expenseDetailsRepository.product(id);
  }
}
