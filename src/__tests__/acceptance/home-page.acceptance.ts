import { Client } from '@loopback/testlab'
import { App } from '../..'
import { setupApplication } from './test-helper'

describe('HomePage', function () {
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

  it('exposes a default home page', async () => {
    await client
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
  })

  it('exposes self-hosted explorer', async () => {
    await client
      .get('/explorer/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect(/<title>LoopBack API Explorer/)
  })
})
