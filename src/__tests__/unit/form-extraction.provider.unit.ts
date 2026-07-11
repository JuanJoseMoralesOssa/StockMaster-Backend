import { expect } from '@loopback/testlab'
import {
  FallbackFormVisionProvider,
  FormVisionProvider,
  GeminiFormVisionProvider,
  createFormVisionProvider,
  VisionProviderError,
} from '../../modules/form-extraction/form-extraction.provider'
import { RawExtractionFields } from '../../modules/form-extraction/form-extraction.normalizer'
import { GeminiQuotaTracker } from '../../modules/form-extraction/gemini/gemini-quota-tracker'
import { GeminiTransport } from '../../modules/form-extraction/gemini/gemini-transport'

/** A well-formed answer with every field blank — enough to satisfy the parser. */
const EMPTY_FIELDS = {
  fecha: null,
  librasTotal: null,
  pieles: null,
  sebo: null,
  hueso: null,
  recibiDelSr: null,
  fieldConfidences: {
    fecha: 0,
    librasTotal: 0,
    pieles: 0,
    sebo: 0,
    hueso: 0,
    recibiDelSr: 0,
  },
}

describe('GeminiFormVisionProvider', () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalMediaResolution = process.env.GEMINI_MEDIA_RESOLUTION
  const originalModel = process.env.GEMINI_VISION_MODEL
  const originalFallbackModels = process.env.GEMINI_VISION_FALLBACK_MODELS

  // Quota state is now instance-scoped: each `new GeminiFormVisionProvider()`
  // starts fresh, so no global reset is needed between tests.
  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.GEMINI_API_KEY = originalApiKey
    if (originalMediaResolution === undefined) {
      delete process.env.GEMINI_MEDIA_RESOLUTION
    } else {
      process.env.GEMINI_MEDIA_RESOLUTION = originalMediaResolution
    }
    if (originalModel === undefined) {
      delete process.env.GEMINI_VISION_MODEL
    } else {
      process.env.GEMINI_VISION_MODEL = originalModel
    }
    if (originalFallbackModels === undefined) {
      delete process.env.GEMINI_VISION_FALLBACK_MODELS
    } else {
      process.env.GEMINI_VISION_FALLBACK_MODELS = originalFallbackModels
    }
  })

  it('sends high media resolution by default', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    delete process.env.GEMINI_MEDIA_RESOLUTION

    let requestBody:
      | {
          generationConfig?: {
            mediaResolution?: string
            maxOutputTokens?: number
            temperature?: number
            thinkingConfig?: { thinkingLevel?: string }
          }
          contents?: Array<{
            parts?: Array<{ text?: string; inline_data?: unknown }>
          }>
        }
      | undefined

    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      fecha: null,
                      librasTotal: null,
                      pieles: null,
                      sebo: null,
                      hueso: null,
                      recibiDelSr: null,
                      fieldConfidences: {
                        fecha: 0,
                        librasTotal: 0,
                        pieles: 0,
                        sebo: 0,
                        hueso: 0,
                        recibiDelSr: 0,
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    await new GeminiFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(requestBody?.generationConfig?.mediaResolution).to.equal(
      'MEDIA_RESOLUTION_HIGH',
    )
    expect(requestBody?.generationConfig?.thinkingConfig).to.containDeep({
      thinkingLevel: 'MEDIUM',
    })
    expect(requestBody?.generationConfig?.maxOutputTokens).to.equal(4096)
    expect(requestBody?.generationConfig).to.not.have.property('temperature')
    const parts = requestBody?.contents?.[0]?.parts
    expect(parts?.[0]?.text).to.match(/Return only valid JSON/)
    expect(parts?.[1]?.inline_data).to.be.ok()
  })

  it('falls back to the next model on Gemini quota errors', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS = 'gemini-3-flash-preview'

    const requestedUrls: string[] = []

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url))

      if (requestedUrls.length === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'RESOURCE_EXHAUSTED: quota exceeded' },
          }),
          { status: 429, statusText: 'Too Many Requests' },
        )
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      fecha: null,
                      librasTotal: null,
                      pieles: 100,
                      sebo: null,
                      hueso: null,
                      recibiDelSr: null,
                      fieldConfidences: {
                        fecha: 0,
                        librasTotal: 0,
                        pieles: 0.99,
                        sebo: 0,
                        hueso: 0,
                        recibiDelSr: 0,
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const result = await new GeminiFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(requestedUrls).to.have.length(2)
    expect(requestedUrls[0]).to.containEql('gemini-3.5-flash')
    expect(requestedUrls[1]).to.containEql('gemini-3-flash-preview')
  })

  it('uses the configured fallback model when the primary local RPM quota is full', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS = 'gemini-3.1-flash-lite'

    const requestedUrls: string[] = []

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url))
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      fecha: null,
                      librasTotal: null,
                      pieles: 100,
                      sebo: null,
                      hueso: null,
                      recibiDelSr: null,
                      fieldConfidences: {
                        fecha: 0,
                        librasTotal: 0,
                        pieles: 0.99,
                        sebo: 0,
                        hueso: 0,
                        recibiDelSr: 0,
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const provider = new GeminiFormVisionProvider()
    for (let index = 0; index < 6; index += 1) {
      await provider.readForm(Buffer.from(`image-${index}`), 'image/jpeg')
    }

    expect(requestedUrls).to.have.length(6)
    for (const url of requestedUrls.slice(0, 5)) {
      expect(url).to.containEql('gemini-3.5-flash')
    }
    expect(requestedUrls[5]).to.containEql('gemini-3.1-flash-lite')
  })

  it('falls back when a Gemini model times out', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS = 'gemini-3-flash-preview'

    const requestedUrls: string[] = []

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url))

      if (requestedUrls.length === 1) {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      fecha: null,
                      librasTotal: null,
                      pieles: 100,
                      sebo: null,
                      hueso: null,
                      recibiDelSr: null,
                      fieldConfidences: {
                        fecha: 0,
                        librasTotal: 0,
                        pieles: 0.99,
                        sebo: 0,
                        hueso: 0,
                        recibiDelSr: 0,
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const result = await new GeminiFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(requestedUrls).to.have.length(2)
    expect(requestedUrls[0]).to.containEql('gemini-3.5-flash')
    expect(requestedUrls[1]).to.containEql('gemini-3-flash-preview')
  })

  // B14: parseExtractionJson's fence fallback recovers a fenced payload…
  it('recovers extraction JSON wrapped in markdown fences', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    const payload = JSON.stringify({
      fecha: '14/12/2025',
      librasTotal: null,
      pieles: 100,
      sebo: null,
      hueso: null,
      recibiDelSr: 'Juan',
      fieldConfidences: {
        fecha: 0.95,
        librasTotal: 0,
        pieles: 0.99,
        sebo: 0,
        hueso: 0,
        recibiDelSr: 0.9,
      },
    })

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '```json\n' + payload + '\n```' }],
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch

    const result = await new GeminiFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(result.recibiDelSr).to.equal('Juan')
  })

  // …and truly malformed JSON becomes a typed unprocessable failure (→ 422).
  it('classifies malformed extraction JSON as unprocessable', async () => {
    process.env.GEMINI_API_KEY = 'test-key'

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'esto no es JSON { fecha:' }] } },
          ],
        }),
        { status: 200 },
      )) as typeof fetch

    const error = await new GeminiFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
    expect((error as VisionProviderError).message).to.match(
      /JSON de extracción válido/,
    )
  })
})

describe('FallbackFormVisionProvider', () => {
  const raw: RawExtractionFields = {
    fecha: null,
    librasTotal: null,
    pieles: 100,
    sebo: null,
    hueso: null,
    recibiDelSr: 'Juan',
    fieldConfidences: {
      fecha: 0,
      librasTotal: 0,
      pieles: 0.99,
      sebo: 0,
      hueso: 0,
      recibiDelSr: 0.9,
    },
  }

  class StubProvider implements FormVisionProvider {
    calls = 0

    constructor(
      readonly name: string,
      private readonly result: RawExtractionFields | VisionProviderError,
    ) {}

    async readForm(): Promise<RawExtractionFields> {
      this.calls += 1
      if (this.result instanceof VisionProviderError) throw this.result
      return this.result
    }
  }

  it('tries the next provider when the primary provider fails', async () => {
    const primary = new StubProvider(
      'gemini',
      new VisionProviderError('rate_limited', 'Gemini ocupado'),
    )
    const fallback = new StubProvider('ollama', raw)

    const result = await new FallbackFormVisionProvider([
      primary,
      fallback,
    ]).readForm(Buffer.from('image'), 'image/jpeg')

    expect(result.pieles).to.equal(100)
    expect(primary.calls).to.equal(1)
    expect(fallback.calls).to.equal(1)
  })

  it('uses the configured provider chain order', () => {
    const originalProvider = process.env.FORM_VISION_PROVIDER
    const originalChain = process.env.FORM_VISION_PROVIDER_CHAIN

    process.env.FORM_VISION_PROVIDER = 'chain'
    process.env.FORM_VISION_PROVIDER_CHAIN = 'gemini,ollama,ocrspace,groq'

    const provider = createFormVisionProvider()

    expect(provider.name).to.equal('gemini->ollama->ocrspace->groq')

    if (originalProvider === undefined) delete process.env.FORM_VISION_PROVIDER
    else process.env.FORM_VISION_PROVIDER = originalProvider
    if (originalChain === undefined)
      delete process.env.FORM_VISION_PROVIDER_CHAIN
    else process.env.FORM_VISION_PROVIDER_CHAIN = originalChain
  })
})

// Cost accounting of the fallback chain (audit Findings H3/H5/H6). These assert
// the chain's OBSERVABLE spending: how much local quota is left afterwards, and
// how many model calls were actually billed — not which methods were called.
describe('GeminiFormVisionProvider quota accounting', () => {
  const MODEL = 'gemini-3.5-flash' // rpm 5
  const HIGH_RES_ESTIMATE = 2620 // 1120 visual + 1500 reserve, at MEDIA_RESOLUTION_HIGH

  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalModel = process.env.GEMINI_VISION_MODEL
  const originalFallbackModels = process.env.GEMINI_VISION_FALLBACK_MODELS

  /**
   * How many requests the model has left this minute. Spends them to find out,
   * so call it once per test, at the end.
   */
  function remainingRequests(
    tracker: GeminiQuotaTracker,
    model: string,
  ): number {
    let free = 0
    while (free < 10 && tracker.reserve(model, 1).ok) free += 1
    return free
  }

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = MODEL
    process.env.GEMINI_VISION_FALLBACK_MODELS = ''
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.GEMINI_API_KEY = originalApiKey
    if (originalModel === undefined) delete process.env.GEMINI_VISION_MODEL
    else process.env.GEMINI_VISION_MODEL = originalModel
    if (originalFallbackModels === undefined)
      delete process.env.GEMINI_VISION_FALLBACK_MODELS
    else process.env.GEMINI_VISION_FALLBACK_MODELS = originalFallbackModels
  })

  it('keeps a timed-out attempt on the books: Gemini already counted it', async () => {
    globalThis.fetch = (async () => {
      const abort = new Error('The operation was aborted')
      abort.name = 'AbortError'
      throw abort
    }) as typeof fetch

    const quota = new GeminiQuotaTracker()
    await expect(
      new GeminiFormVisionProvider(new GeminiTransport(), quota).readForm(
        Buffer.from('image'),
        'image/jpeg',
      ),
    ).to.be.rejectedWith(VisionProviderError)

    // 5 RPM minus the one request that DID reach Gemini before we hung up.
    // Refunding it here is what used to make the guard over-permit and push the
    // real 429s onto the remote API.
    expect(remainingRequests(quota, MODEL)).to.equal(4)
  })

  it('refunds an attempt that never left the process', async () => {
    delete process.env.GEMINI_API_KEY
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const quota = new GeminiQuotaTracker()
    await expect(
      new GeminiFormVisionProvider(new GeminiTransport(), quota).readForm(
        Buffer.from('image'),
        'image/jpeg',
      ),
    ).to.be.rejectedWith(VisionProviderError)

    expect(fetchCalls).to.equal(0)
    // Nothing was sent, so nothing was spent: the whole minute is still there.
    expect(remainingRequests(quota, MODEL)).to.equal(5)
  })

  it('charges the token window what Gemini billed, not what we guessed', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(EMPTY_FIELDS) }] } },
          ],
          // Far above the pre-flight estimate: a thinking-heavy call.
          usageMetadata: { promptTokenCount: 1200, totalTokenCount: 249_000 },
        }),
        { status: 200 },
      )) as typeof fetch

    const quota = new GeminiQuotaTracker()
    await new GeminiFormVisionProvider(new GeminiTransport(), quota).readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    // The 250K TPM budget is now genuinely spent. Had the estimate stayed on the
    // books, the guard would happily wave through another call.
    const next = quota.reserve(MODEL, HIGH_RES_ESTIMATE)
    expect(next.ok).to.be.false()
    if (!next.ok) expect(next.reason).to.match(/TPM/)
  })
})

describe('GeminiFormVisionProvider client cancellation', () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.GEMINI_API_KEY
  const originalModel = process.env.GEMINI_VISION_MODEL
  const originalFallbackModels = process.env.GEMINI_VISION_FALLBACK_MODELS

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.GEMINI_API_KEY = originalApiKey
    if (originalModel === undefined) delete process.env.GEMINI_VISION_MODEL
    else process.env.GEMINI_VISION_MODEL = originalModel
    if (originalFallbackModels === undefined)
      delete process.env.GEMINI_VISION_FALLBACK_MODELS
    else process.env.GEMINI_VISION_FALLBACK_MODELS = originalFallbackModels
  })

  it('stops the chain when the client hangs up mid-call', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS =
      'gemini-3.1-flash-lite,gemini-2.5-flash'

    const clientGone = new AbortController()
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      // The browser gave up while this call was in flight.
      clientGone.abort()
      const abort = new Error('The operation was aborted')
      abort.name = 'AbortError'
      throw abort
    }) as typeof fetch

    const error = await new GeminiFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg', clientGone.signal)
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      )

    // Two more models were configured. Trying them would bill Gemini for an
    // answer nobody is left to read.
    expect(fetchCalls).to.equal(1)
    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('client_aborted')
  })

  it('does not call the model at all when the client is already gone', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_VISION_MODEL = 'gemini-3.5-flash'
    process.env.GEMINI_VISION_FALLBACK_MODELS = ''

    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const clientGone = new AbortController()
    clientGone.abort()

    await expect(
      new GeminiFormVisionProvider().readForm(
        Buffer.from('image'),
        'image/jpeg',
        clientGone.signal,
      ),
    ).to.be.rejectedWith(VisionProviderError)

    expect(fetchCalls).to.equal(0)
  })
})
