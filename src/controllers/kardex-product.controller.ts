import {
  repository,
} from '@loopback/repository';
import {
  param,
  get,
  getModelSchemaRef,
} from '@loopback/rest';
import {
  Kardex,
  Product,
} from '../models';
import {KardexRepository} from '../repositories';

export class KardexProductController {
  constructor(
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
  ) { }

  @get('/kardexes/{id}/product', {
    responses: {
      '200': {
        description: 'Product belonging to Kardex',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Product),
          },
        },
      },
    },
  })
  async getProduct(
    @param.path.number('id') id: typeof Kardex.prototype.id,
  ): Promise<Product> {
    return this.kardexRepository.product(id);
  }
}
