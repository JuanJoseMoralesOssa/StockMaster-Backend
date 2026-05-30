import { repository } from '@loopback/repository'
import { get, getModelSchemaRef, param } from '@loopback/rest'
import { Roles, requireRoles } from '../../../auth'
import { Kardex, Product } from '../../../models'
import { KardexRepository } from '../../../repositories'

// Lectura de kardex vía producto: solo Oficina y Admin
@requireRoles(Roles.OFFICE, Roles.ADMIN)
export class KardexProductController {
  constructor(
    @repository(KardexRepository)
    public kardexRepository: KardexRepository,
  ) {}

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
    return this.kardexRepository.product(id)
  }
}
