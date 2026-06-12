import { Client } from '@loopback/testlab'
import { App } from '../..'
import { Roles } from '../../auth'
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

  it('rejects operator requests to office/admin product reads with 403', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects office requests to admin-only user deletion with 403', async () => {
    await rawClient
      .delete('/users/999999')
      .set('Authorization', `Bearer ${makeToken(Roles.OFFICE)}`)
      .expect(403)
  })
})
