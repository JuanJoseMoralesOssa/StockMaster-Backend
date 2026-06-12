import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import {
  FORM_VISION_PROVIDER_BINDING,
  FormVisionProvider,
} from '../../services/form-extraction.provider'
import { setupApplication } from './test-helper'

describe('Purchase extraction', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
    // bind() replaces the existing FormVisionProvider binding with the stub.
    app.bind(FORM_VISION_PROVIDER_BINDING).to({
      name: 'stub',
      async readForm() {
        return {
          fecha: '11/06/2026',
          librasTotal: 100,
          pieles: 100,
          sebo: null,
          hueso: null,
          recibiDelSr: 'Proveedor Extract',
          fieldConfidences: {
            fecha: 0.99,
            librasTotal: 0.99,
            pieles: 0.99,
            sebo: 0.99,
            hueso: 0.99,
            recibiDelSr: 0.99,
          },
        }
      },
    } satisfies FormVisionProvider)
  })

  after(async () => {
    await app.stop()
  })

  it('normalizes a multipart image through an injected vision provider', async () => {
    const tag = `extract-${Date.now()}`
    const personRes = await client
      .post('/people')
      .send({ name: 'Proveedor Extract' })
      .expect(200)
    const productRes = await client
      .post('/products')
      .send({ name: `Pieles ${tag}`, stock: 0 })
      .expect(200)

    const res = await client
      .post('/purchases/extract')
      .attach('image', Buffer.from('not-a-real-image'), {
        filename: 'form.png',
        contentType: 'image/png',
      })
      .expect(200)

    expect(res.body.date).to.containDeep({ value: '2026-06-11' })
    expect(res.body.supplier).to.containDeep({
      personId: personRes.body.id,
      needsReview: false,
    })
    expect(res.body.details[0]).to.containDeep({
      productId: productRes.body.id,
      weightLb: 100,
      weightKg: 45.359,
      needsReview: false,
    })
  })
})
