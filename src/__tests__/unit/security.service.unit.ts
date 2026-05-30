import { expect } from '@loopback/testlab'
import { HttpErrors } from '@loopback/rest'
import { SecurityService } from '../../services/security.service'
import { UserRepository } from '../../repositories'
import { User } from '../../models'

// hashPassword/verifyPassword/generateToken/verifyToken no usan el repositorio,
// así que para unit tests basta inyectar un stub.
function makeService(): SecurityService {
  return new SecurityService(undefined as unknown as UserRepository)
}

const sampleUser = {
  id: 7,
  name: 'Ana',
  email: 'ana@local',
  role: 'admin',
} as User

describe('SecurityService (unit)', () => {
  const service = makeService()

  describe('password hashing', () => {
    it('hashes a password (no reversible) y verifica el correcto', async () => {
      const hash = await service.hashPassword('secreto123')
      expect(hash).to.not.equal('secreto123')
      expect(await service.verifyPassword('secreto123', hash)).to.be.true()
    })

    it('rechaza una contraseña incorrecta', async () => {
      const hash = await service.hashPassword('secreto123')
      expect(await service.verifyPassword('otra', hash)).to.be.false()
    })

    it('genera hashes distintos para la misma contraseña (salt aleatorio)', async () => {
      const a = await service.hashPassword('misma')
      const b = await service.hashPassword('misma')
      expect(a).to.not.equal(b)
    })
  })

  describe('JWT', () => {
    it('genera y verifica un token con el payload correcto', () => {
      const token = service.generateToken(sampleUser)
      const payload = service.verifyToken(token)
      expect(payload.id).to.equal('7')
      expect(payload.email).to.equal('ana@local')
      expect(payload.role).to.equal('admin')
    })

    it('expone el rol vía getRoleFromToken', () => {
      const token = service.generateToken(sampleUser)
      expect(service.getRoleFromToken(token)).to.equal('admin')
    })

    it('lanza Unauthorized con un token inválido', () => {
      expect(() => service.verifyToken('no-es-un-jwt')).to.throw(
        HttpErrors.Unauthorized,
      )
    })
  })
})
