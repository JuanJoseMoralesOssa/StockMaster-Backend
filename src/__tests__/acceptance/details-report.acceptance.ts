import { Client } from '@loopback/testlab'
import { App } from '../..'
import { setupApplication } from './test-helper'

describe('Details reports', function () {
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

  it('rejects malformed supplier-product date filters with 400', async () => {
    await client
      .get(
        '/reports/details/supplier/1/product/1?startDate=not-a-date&endDate=2026-04-01',
      )
      .expect(400)
  })
})
