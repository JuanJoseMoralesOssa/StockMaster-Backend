import { expect } from '@loopback/testlab'
import { buildCorsOrigin } from '../../config/cors'

describe('buildCorsOrigin', () => {
  it('permite orígenes localhost de Vite en desarrollo aunque cambien de puerto', done => {
    const handler = buildCorsOrigin({ NODE_ENV: 'development' })

    handler('http://localhost:5174', (err, allow) => {
      expect(err).to.be.null()
      expect(allow).to.be.true()
      done()
    })
  })

  it('permite orígenes explícitamente configurados en FRONTEND_ORIGIN', done => {
    const handler = buildCorsOrigin({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://app.example.com',
    })

    handler('https://app.example.com', (err, allow) => {
      expect(err).to.be.null()
      expect(allow).to.be.true()
      done()
    })
  })

  it('rechaza orígenes no permitidos', done => {
    const handler = buildCorsOrigin({ NODE_ENV: 'development' })

    handler('https://evil.example.com', err => {
      expect(err).to.not.be.null()
      done()
    })
  })
})
