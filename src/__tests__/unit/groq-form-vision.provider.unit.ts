import { expect } from '@loopback/testlab'
import { VisionProviderError } from '../../modules/form-extraction/form-extraction.provider'
import { GroqFormVisionProvider } from '../../modules/form-extraction/providers/groq-form-vision.provider'

const OK_PAYLOAD = JSON.stringify({
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

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
  })
}

describe('GroqFormVisionProvider', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GROQ_API_KEY
  const originalModel = process.env.GROQ_VISION_MODEL
  const originalFallbacks = process.env.GROQ_VISION_FALLBACK_MODELS

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    restore('GROQ_API_KEY', originalKey)
    restore('GROQ_VISION_MODEL', originalModel)
    restore('GROQ_VISION_FALLBACK_MODELS', originalFallbacks)
  })

  it('sends an OpenAI-style multimodal JSON request and parses the fields', async () => {
    process.env.GROQ_API_KEY = 'test-key'
    process.env.GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

    let requestUrl: string | undefined
    let requestBody:
      | {
          model?: string
          response_format?: { type?: string }
          messages?: Array<{
            role?: string
            content?:
              | string
              | Array<{ type?: string; image_url?: { url?: string } }>
          }>
        }
      | undefined

    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestUrl = String(url)
      requestBody = JSON.parse(String(init?.body))
      return chatResponse(OK_PAYLOAD)
    }) as typeof fetch

    const result = await new GroqFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(result.recibiDelSr).to.equal('Juan')
    expect(requestUrl).to.containEql('/chat/completions')
    expect(requestBody?.model).to.equal(
      'meta-llama/llama-4-scout-17b-16e-instruct',
    )
    expect(requestBody?.response_format?.type).to.equal('json_object')
    const userContent = requestBody?.messages?.[1]?.content
    expect(userContent).to.be.an.Array()
    const imagePart = (
      userContent as Array<{ type?: string; image_url?: { url?: string } }>
    ).find(part => part.type === 'image_url')
    expect(imagePart?.image_url?.url).to.match(/^data:image\/jpeg;base64,/)
  })

  it('falls back to the next model on a Groq 429', async () => {
    process.env.GROQ_API_KEY = 'test-key'
    process.env.GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
    process.env.GROQ_VISION_FALLBACK_MODELS = 'qwen/qwen3.6-27b'

    const requestedModels: string[] = []
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body))
      requestedModels.push(body.model)
      if (requestedModels.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limit reached' } }),
          { status: 429, statusText: 'Too Many Requests' },
        )
      }
      return chatResponse(OK_PAYLOAD)
    }) as typeof fetch

    const result = await new GroqFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(requestedModels).to.eql([
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'qwen/qwen3.6-27b',
    ])
  })

  it('falls back when a Groq model times out', async () => {
    process.env.GROQ_API_KEY = 'test-key'
    process.env.GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
    process.env.GROQ_VISION_FALLBACK_MODELS = 'qwen/qwen3.6-27b'

    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      }
      return chatResponse(OK_PAYLOAD)
    }) as typeof fetch

    const result = await new GroqFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(calls).to.equal(2)
  })

  it('classifies malformed extraction JSON as unprocessable', async () => {
    process.env.GROQ_API_KEY = 'test-key'
    process.env.GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
    delete process.env.GROQ_VISION_FALLBACK_MODELS

    globalThis.fetch = (async () =>
      chatResponse('esto no es JSON { fecha:')) as typeof fetch

    const error = await new GroqFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
  })

  it('reports a missing API key as an unprocessable config error', async () => {
    delete process.env.GROQ_API_KEY

    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called without an API key')
    }) as typeof fetch

    const error = await new GroqFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
    expect((error as VisionProviderError).message).to.match(/GROQ_VISION_MODEL/)
  })
})
