import { expect } from '@loopback/testlab'
import { VisionProviderError } from '../../modules/form-extraction/form-extraction.provider'
import { OllamaFormVisionProvider } from '../../modules/form-extraction/providers/ollama-form-vision.provider'

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

const OK_KEY_VALUE_PAYLOAD = `Fecha: 14/12/2025
LibrasTotal: null
Pieles: 100
Sebo: null
Hueso: null
RecibiDelSr: Juan`

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { content } }), { status })
}

describe('OllamaFormVisionProvider', () => {
  const originalFetch = globalThis.fetch
  const originalHost = process.env.OLLAMA_HOST
  const originalKey = process.env.OLLAMA_API_KEY
  const originalModel = process.env.OLLAMA_VISION_MODEL
  const originalFallbacks = process.env.OLLAMA_VISION_FALLBACK_MODELS

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    restore('OLLAMA_HOST', originalHost)
    restore('OLLAMA_API_KEY', originalKey)
    restore('OLLAMA_VISION_MODEL', originalModel)
    restore('OLLAMA_VISION_FALLBACK_MODELS', originalFallbacks)
  })

  it('sends a native Ollama vision chat request and parses the fields', async () => {
    process.env.OLLAMA_HOST = 'https://ollama.com'
    process.env.OLLAMA_API_KEY = 'test-key'
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b'

    let requestUrl: string | undefined
    let authHeader: string | null | undefined
    let requestBody:
      | {
          model?: string
          format?: string
          stream?: boolean
          messages?: Array<{
            role?: string
            content?: string
            images?: string[]
          }>
        }
      | undefined

    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestUrl = String(url)
      authHeader = new Headers(init?.headers).get('Authorization')
      requestBody = JSON.parse(String(init?.body))
      return chatResponse(OK_KEY_VALUE_PAYLOAD)
    }) as typeof fetch

    const result = await new OllamaFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(result.recibiDelSr).to.equal('Juan')
    expect(requestUrl).to.equal('https://ollama.com/api/chat')
    expect(authHeader).to.equal('Bearer test-key')
    expect(requestBody?.model).to.equal('qwen2.5vl:7b')
    expect(requestBody?.stream).to.equal(false)
    expect(requestBody).to.not.have.property('format')
    expect(requestBody?.messages?.[1]?.content).to.match(/key-value|JSON/i)
    expect(requestBody?.messages?.[1]?.images?.[0]).to.equal(
      Buffer.from('image').toString('base64'),
    )
  })

  it('keeps compatibility with JSON responses from Ollama models', async () => {
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b'

    globalThis.fetch = (async () => chatResponse(OK_PAYLOAD)) as typeof fetch

    const result = await new OllamaFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(result.recibiDelSr).to.equal('Juan')
    expect(result.fieldConfidences.pieles).to.equal(0.99)
  })

  it('falls back to the next model on an Ollama 429', async () => {
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b'
    process.env.OLLAMA_VISION_FALLBACK_MODELS = 'llama3.2-vision'

    const requestedModels: string[] = []
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body))
      requestedModels.push(body.model)
      if (requestedModels.length === 1) {
        return new Response(JSON.stringify({ error: 'rate limit reached' }), {
          status: 429,
          statusText: 'Too Many Requests',
        })
      }
      return chatResponse(OK_KEY_VALUE_PAYLOAD)
    }) as typeof fetch

    const result = await new OllamaFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(requestedModels).to.eql(['qwen2.5vl:7b', 'llama3.2-vision'])
  })

  it('classifies malformed extraction JSON as unprocessable', async () => {
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b'
    delete process.env.OLLAMA_VISION_FALLBACK_MODELS

    globalThis.fetch = (async () =>
      chatResponse('esto no trae campos reconocibles')) as typeof fetch

    const error = await new OllamaFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
  })

  it('does not require an API key for local Ollama', async () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434'
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b'
    delete process.env.OLLAMA_API_KEY

    let authHeader: string | null | undefined
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      authHeader = new Headers(init?.headers).get('Authorization')
      return chatResponse(OK_KEY_VALUE_PAYLOAD)
    }) as typeof fetch

    const result = await new OllamaFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.pieles).to.equal(100)
    expect(authHeader).to.equal(null)
  })
})
