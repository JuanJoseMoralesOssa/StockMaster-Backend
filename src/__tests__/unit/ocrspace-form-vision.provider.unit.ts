import { expect } from '@loopback/testlab'
import { VisionProviderError } from '../../modules/form-extraction/form-extraction.provider'
import { OcrSpaceFormVisionProvider } from '../../modules/form-extraction/providers/ocrspace-form-vision.provider'

const OCR_TEXT = `Fecha: 14/12/2025
LIBRAS: 100
PIELES: 70
Recibí del Sr.: Juan
Libra de Sebo: 20
Hueso: 10`

function ocrResponse(parsedText: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      ParsedResults: [{ ParsedText: parsedText }],
      IsErroredOnProcessing: false,
    }),
    { status },
  )
}

describe('OcrSpaceFormVisionProvider', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.OCRSPACE_API_KEY
  const originalBaseUrl = process.env.OCRSPACE_BASE_URL
  const originalLanguage = process.env.OCRSPACE_LANGUAGE
  const originalEngine = process.env.OCRSPACE_ENGINE

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    restore('OCRSPACE_API_KEY', originalKey)
    restore('OCRSPACE_BASE_URL', originalBaseUrl)
    restore('OCRSPACE_LANGUAGE', originalLanguage)
    restore('OCRSPACE_ENGINE', originalEngine)
  })

  it('sends a base64 OCR.space request and parses returned OCR text', async () => {
    process.env.OCRSPACE_API_KEY = 'test-key'
    process.env.OCRSPACE_BASE_URL = 'https://api.ocr.space/parse/image'
    process.env.OCRSPACE_LANGUAGE = 'spa'
    process.env.OCRSPACE_ENGINE = '2'

    let requestUrl: string | undefined
    let requestBody: FormData | undefined

    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestUrl = String(url)
      requestBody = init?.body as FormData
      return ocrResponse(OCR_TEXT)
    }) as typeof fetch

    const result = await new OcrSpaceFormVisionProvider().readForm(
      Buffer.from('image'),
      'image/jpeg',
    )

    expect(result.fecha).to.equal('14/12/2025')
    expect(result.librasTotal).to.equal(100)
    expect(result.pieles).to.equal(70)
    expect(result.sebo).to.equal(20)
    expect(result.hueso).to.equal(10)
    expect(result.recibiDelSr).to.equal('Juan')
    expect(requestUrl).to.equal('https://api.ocr.space/parse/image')
    expect(requestBody?.get('apikey')).to.equal('test-key')
    expect(requestBody?.get('language')).to.equal('spa')
    expect(requestBody?.get('OCREngine')).to.equal('2')
    expect(String(requestBody?.get('base64Image'))).to.match(
      /^data:image\/jpeg;base64,/,
    )
  })

  it('maps OCR.space processing rate limits to a typed rate_limited error', async () => {
    process.env.OCRSPACE_API_KEY = 'test-key'

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          IsErroredOnProcessing: true,
          ErrorMessage: 'rate limit reached',
        }),
        { status: 429, statusText: 'Too Many Requests' },
      )) as typeof fetch

    const error = await new OcrSpaceFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('rate_limited')
  })

  it('classifies OCR text without recognizable fields as unprocessable', async () => {
    process.env.OCRSPACE_API_KEY = 'test-key'

    globalThis.fetch = (async () =>
      ocrResponse('texto sin campos del formulario')) as typeof fetch

    const error = await new OcrSpaceFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
  })

  it('reports a missing API key as an unprocessable config error', async () => {
    delete process.env.OCRSPACE_API_KEY

    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called without an API key')
    }) as typeof fetch

    const error = await new OcrSpaceFormVisionProvider()
      .readForm(Buffer.from('image'), 'image/jpeg')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).to.be.instanceOf(VisionProviderError)
    expect((error as VisionProviderError).kind).to.equal('unprocessable')
  })
})
