import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { setupApplication } from './test-helper'

describe('PingController', function () {
  // App boot connects eagerly to the (remote) database, which can take a few
  // seconds — mocha's default 2s hook timeout is too tight.
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  it('invokes GET /ping', async () => {
    const res = await client.get('/ping?msg=world').expect(200)
    expect(res.body).to.containEql({ greeting: 'Hello from LoopBack' })
  })
})
