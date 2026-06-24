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
  const providerName = `Proveedor Extract ${Date.now()}`

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
          recibiDelSr: providerName,
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
    let personId: number | undefined
    let productId: number | undefined

    try {
      const personRes = await client
        .post('/people')
        .send({ name: providerName })
        .expect(200)
      personId = personRes.body.id

      const productRes = await client
        .post('/products')
        .send({ name: `Pieles ${tag}`, stock: 0 })
        .expect(200)
      productId = productRes.body.id

      const res = await client
        .post('/purchases/extract')
        .attach('image', Buffer.from('not-a-real-image'), {
          filename: 'form.png',
          contentType: 'image/png',
        })
        .expect(200)

      expect(res.body.date).to.containDeep({ value: '2026-06-11' })
      expect(res.body.supplier).to.containDeep({
        personId,
        needsReview: false,
      })
      expect(res.body.details[0]).to.containDeep({
        fieldName: 'pieles',
        weightLb: 100,
        weightKg: 45.359,
        needsReview: false,
      })
      expect(res.body.details[0].productId).to.be.Number()
      expect(String(res.body.details[0].productName)).to.match(/pieles/i)
    } finally {
      if (productId) {
        await client.del(`/products/${productId}`).catch(() => undefined)
      }
      if (personId) {
        await client.del(`/people/${personId}`).catch(() => undefined)
      }
    }
  })

  it('accepts an optimized JPEG upload', async () => {
    const res = await client
      .post('/purchases/extract')
      .attach('image', Buffer.from('optimized-jpeg'), {
        filename: 'form.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200)

    expect(res.body.details[0]).to.containDeep({
      fieldName: 'pieles',
      weightLb: 100,
    })
  })

  it('rejects requests without an image field', async () => {
    await client
      .post('/purchases/extract')
      .field('note', 'missing image')
      .expect(400)
  })

  it('rejects non-image uploads', async () => {
    await client
      .post('/purchases/extract')
      .attach('image', Buffer.from('not an image'), {
        filename: 'form.txt',
        contentType: 'text/plain',
      })
      .expect(400)
  })
})

describe('Purchase extraction rate limit', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client
  let originalRpmLimit: string | undefined
  let originalRpdLimit: string | undefined

  before('setupApplication', async () => {
    originalRpmLimit = process.env.GEMINI_EXTRACT_RPM_LIMIT
    originalRpdLimit = process.env.GEMINI_EXTRACT_RPD_LIMIT
    process.env.GEMINI_EXTRACT_RPM_LIMIT = '2'
    process.env.GEMINI_EXTRACT_RPD_LIMIT = '20'
    ;({ app, client } = await setupApplication())
    app.bind(FORM_VISION_PROVIDER_BINDING).to({
      name: 'stub',
      async readForm() {
        return {
          fecha: '11/06/2026',
          librasTotal: 100,
          pieles: 100,
          sebo: null,
          hueso: null,
          recibiDelSr: 'Proveedor Rate Limit',
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
    if (originalRpmLimit == null) {
      delete process.env.GEMINI_EXTRACT_RPM_LIMIT
    } else {
      process.env.GEMINI_EXTRACT_RPM_LIMIT = originalRpmLimit
    }
    if (originalRpdLimit == null) {
      delete process.env.GEMINI_EXTRACT_RPD_LIMIT
    } else {
      process.env.GEMINI_EXTRACT_RPD_LIMIT = originalRpdLimit
    }
    await app.stop()
  })

  it('caps extraction requests per minute before calling Gemini again', async () => {
    for (let index = 0; index < 2; index += 1) {
      await client
        .post('/purchases/extract')
        .attach('image', Buffer.from(`optimized-jpeg-${index}`), {
          filename: `form-${index}.jpg`,
          contentType: 'image/jpeg',
        })
        .expect(200)
    }

    const res = await client
      .post('/purchases/extract')
      .attach('image', Buffer.from('optimized-jpeg-limited'), {
        filename: 'form-limited.jpg',
        contentType: 'image/jpeg',
      })
      .expect(429)

    expect(res.body.error.message).to.containEql('por minuto')
  })
})
