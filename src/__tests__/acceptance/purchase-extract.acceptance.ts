import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import {
  FORM_VISION_PROVIDER_BINDING,
  FormVisionProvider,
  GeminiFormVisionProvider,
} from '../../modules/form-extraction/form-extraction.provider'
import { setupApplication } from './test-helper'

describe('Purchase extraction', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client
  let rawClient: Client
  const providerName = `Proveedor Extract ${Date.now()}`

  before('setupApplication', async () => {
    ;({ app, client, rawClient } = await setupApplication())
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
        .send({ name: `Pieles ${tag}`, balance: 0 })
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
      // The shared live catalogue may already contain a product named "Piel",
      // which legitimately wins the alias match over this test's own
      // "Pieles <tag>" row — assert the alias family, not an exact name.
      expect(String(res.body.details[0].productName)).to.match(/piel/i)
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

  it('returns a review result instead of an error when no values are detected', async () => {
    app.bind(FORM_VISION_PROVIDER_BINDING).to({
      name: 'stub-empty',
      async readForm() {
        return {
          fecha: null,
          librasTotal: null,
          pieles: null,
          sebo: null,
          hueso: null,
          recibiDelSr: null,
          fieldConfidences: {
            fecha: 1,
            librasTotal: 1,
            pieles: 1,
            sebo: 1,
            hueso: 1,
            recibiDelSr: 1,
          },
        }
      },
    } satisfies FormVisionProvider)

    const res = await client
      .post('/purchases/extract')
      .field('optimizedSizeBytes', '52910')
      .field('optimizedWidth', '900')
      .field('optimizedHeight', '600')
      .field('cropX', '10')
      .field('cropY', '20')
      .field('cropWidth', '800')
      .field('cropHeight', '500')
      .attach('image', Buffer.from('blank-optimized-jpeg'), {
        filename: 'blank-form.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200)

    expect(res.body.details).to.have.length(0)
    expect(res.body.needsReview).to.equal(true)
    expect(res.body.reviewReasons).to.containEql(
      'No se detectaron valores de productos',
    )
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

  // B13: multer's fileSize limit (15 MB) must reject oversized uploads with
  // 400 before the vision provider is ever called.
  it('rejects images larger than 15 MB with 400', async () => {
    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1, 1)
    const res = await client
      .post('/purchases/extract')
      .attach('image', oversized, {
        filename: 'huge-form.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400)

    expect(res.body.error.message).to.containEql('File too large')
  })

  // B19 (la mitad 403/operator ya vive en auth-roles.acceptance.ts).
  it('rejects requests without a JWT with 401', async () => {
    await rawClient
      .post('/purchases/extract')
      .attach('image', Buffer.from('unauthenticated'), {
        filename: 'form.jpg',
        contentType: 'image/jpeg',
      })
      .expect(401)
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

// End-to-end failure mapping of the REAL Gemini fallback chain: the provider
// binding is the actual GeminiFormVisionProvider and only globalThis.fetch is
// stubbed, so these exercise transport → chain → VisionProviderError →
// DomainError → HTTP status. (Plan de validación B14/B15/B16.)
describe('Purchase extraction upstream failures', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client
  const originalFetch = globalThis.fetch
  const originalEnv = {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_VISION_MODEL,
    fallbacks: process.env.GEMINI_VISION_FALLBACK_MODELS,
  }

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
    process.env.GEMINI_API_KEY = 'test-key'
    // Short two-model chain keeps the exhausted-chain tests fast.
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS = 'gemini-3-flash-preview'
  })

  beforeEach(() => {
    // Fresh provider instance per test: quota windows start clean.
    app.bind(FORM_VISION_PROVIDER_BINDING).to(new GeminiFormVisionProvider())
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  after(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('GEMINI_API_KEY', originalEnv.apiKey)
    restore('GEMINI_VISION_MODEL', originalEnv.model)
    restore('GEMINI_VISION_FALLBACK_MODELS', originalEnv.fallbacks)
    await app.stop()
  })

  const postImage = (tag: string) =>
    client.post('/purchases/extract').attach('image', Buffer.from(tag), {
      filename: `${tag}.jpg`,
      contentType: 'image/jpeg',
    })

  // B15: every model in the chain times out → 408 with the Spanish message.
  it('returns 408 when the whole Gemini chain times out', async () => {
    globalThis.fetch = (async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }) as typeof fetch

    const res = await postImage('chain-timeout').expect(408)
    expect(res.body.error.message).to.containEql('tardó demasiado')
  })

  // B16: every model reports exhausted quota → 429 with the Spanish message
  // (distinct from the endpoint's own per-IP limiter message).
  it('returns 429 when the whole Gemini chain is out of quota', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: 'RESOURCE_EXHAUSTED: quota exceeded' },
        }),
        { status: 429, statusText: 'Too Many Requests' },
      )) as typeof fetch

    const res = await postImage('chain-quota').expect(429)
    expect(res.body.error.message).to.containEql('ocupado temporalmente')
  })

  // B14: Gemini answers 200 but with unusable JSON → 422, no fallback retry.
  it('returns 422 when Gemini responds with malformed extraction JSON', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'esto no es JSON { fecha:' }] } },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await postImage('malformed-json').expect(422)
    expect(res.body.error.message).to.containEql('JSON de extracción válido')
    // A parse failure is NOT retryable: the chain must not burn more quota.
    expect(fetchCalls).to.equal(1)
  })
})
