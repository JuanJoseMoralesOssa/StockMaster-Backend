import { Client } from '@loopback/testlab'
import * as jwt from 'jsonwebtoken'
import { App } from '../..'
import { Roles } from '../../auth'
import { securityConfig } from '../../config/security'
import { setupApplication } from './test-helper'

describe('Role authorization', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let rawClient: Client
  let makeToken: (role: string) => string

  before('setupApplication', async () => {
    ;({ app, rawClient, makeToken } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  const basePayload = {
    id: '1',
    name: 'test-user',
    email: 'test-user@local',
    role: Roles.ADMIN,
  }

  it('rejects operator requests to office/admin product reads with 403', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects operator requests to through-product relations with 403', async () => {
    await rawClient
      .get('/purchases/999999/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)

    await rawClient
      .get('/payments/999999/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects operator requests to purchase extraction with 403', async () => {
    await rawClient
      .post('/purchases/extract')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects office requests to admin-only user deletion with 403', async () => {
    await rawClient
      .delete('/users/999999')
      .set('Authorization', `Bearer ${makeToken(Roles.OFFICE)}`)
      .expect(403)
  })

  it('rejects tokens with an unknown role with 403', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${makeToken('ghost')}`)
      .expect(403)
  })

  it('allows any authenticated role on /whoami', async () => {
    await rawClient
      .get('/whoami')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(200)
  })

  it('rejects requests without an Authorization header with 401', async () => {
    await rawClient.get('/products').expect(401)
  })

  it('rejects malformed Authorization headers with 401', async () => {
    await rawClient.get('/products').set('Authorization', 'Bearer').expect(401)
    await rawClient
      .get('/products')
      .set('Authorization', 'Basic abc123')
      .expect(401)
  })

  it('rejects expired tokens with 401', async () => {
    const expired = jwt.sign(basePayload, securityConfig.JWT_SECRET, {
      expiresIn: '-10s',
    })
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401)
  })

  it('rejects tokens signed with a different secret with 401', async () => {
    const forged = jwt.sign(basePayload, 'not-the-real-secret', {
      expiresIn: '1h',
    })
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401)
  })

  it('rejects garbage tokens with 401', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401)
  })
})
