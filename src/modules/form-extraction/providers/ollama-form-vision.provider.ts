// Alternative FormVisionProvider backed by Ollama's native /api/chat endpoint.
// Opt in with FORM_VISION_PROVIDER=ollama.
//
// Local Ollama usually runs at http://localhost:11434 and does not need an API
// key. Ollama Cloud uses OLLAMA_HOST=https://ollama.com plus OLLAMA_API_KEY.

import { RawExtractionFields } from '../form-extraction.normalizer'
import { PRODUCT_FIELD_LABELS, PRODUCT_FIELDS } from '../form-spec'
import {
  EMPTY_TEXT_EXTRACTION_MESSAGE,
  parseExtractionText,
} from '../form-extraction.text-parser'
import {
  FormVisionProvider,
  VisionProviderError,
} from '../form-extraction.provider'
import { sanitizeRawExtraction } from '../gemini/gemini-transport'

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434'
const DEFAULT_OLLAMA_MODEL = 'qwen2.5vl:7b'
const DEFAULT_OLLAMA_FALLBACK_MODELS = ['llama3.2-vision', 'moondream']
const DEFAULT_OLLAMA_TIMEOUT_MS = 15000
const DEFAULT_OLLAMA_TOTAL_TIMEOUT_MS = 45000
const DEFAULT_OLLAMA_MAX_OUTPUT_TOKENS = 2048
const DEFAULT_OLLAMA_TEMPERATURE = 0.1

const OLLAMA_TIMEOUT_MESSAGE =
  'El servicio de lectura del formulario tardó demasiado. Intenta de nuevo.'
const OLLAMA_RATE_LIMITED_MESSAGE =
  'El servicio de lectura del formulario está ocupado temporalmente. Intenta de nuevo en unos minutos.'
const OLLAMA_CONFIG_MESSAGE =
  'El servicio de lectura del formulario no está configurado correctamente. Revisa OLLAMA_HOST, OLLAMA_API_KEY y OLLAMA_VISION_MODEL del servidor.'
const OLLAMA_PARSE_MESSAGE =
  'El servicio de visión respondió, pero no devolvió un JSON de extracción válido. Intenta de nuevo o revisa el modelo configurado.'
const OLLAMA_GENERIC_MESSAGE =
  'No se pudo leer el formulario con el servicio de visión. Intenta de nuevo.'

// The key-value lines Ollama must emit are derived from the shared spec, so a
// product added to form-spec.ts is asked for here too — the prompt cannot drift
// from what the text parser knows how to read (audit Finding H3). The printed
// form labels above stay hand-written: they mirror the physical form's layout,
// which is not derivable from the field list.
const PRODUCT_OUTPUT_LINES = PRODUCT_FIELDS.map(
  field => `${PRODUCT_FIELD_LABELS[field]}: number|null`,
).join('\n')

const OLLAMA_SYSTEM_PROMPT = `You are a data extraction assistant for a livestock/hide trading business (J.A.A.G).
You receive photos of handwritten receipt forms with these printed Spanish labels:
- "Fecha:" -> date
- "LIBRAS" -> total pounds (optional cross-check total, may be blank)
- "PIELES" -> pounds of skins/hides
- "Recibí del Sr." -> supplier/person name
- "Libra de Sebo" -> pounds of tallow (Sebo or Cebo)
- "Hueso" -> pounds of bone
- "Firma:" -> signature box (IGNORE)

Rules:
- Extract ONLY what is handwritten. Do not invent values.
- Colombian decimal format: treat "1.234,5" and "1234.5" as the same value; output numbers with a period decimal.
- If a field is blank or illegible, write null.

Return ONLY these plain key-value lines, no JSON, no markdown, no extra text:
Fecha: value|null
LibrasTotal: number|null
${PRODUCT_OUTPUT_LINES}
RecibiDelSr: value|null`

const OLLAMA_USER_INSTRUCTION =
  'Extract all handwritten values from this J.A.A.G receipt form. Return only the key-value lines described above.'

interface OllamaChatResponse {
  message?: { content?: string }
  error?: string
}

type OllamaRetryKind = 'timeout' | 'rate_limited'

class RetryableOllamaError extends Error {
  constructor(
    message: string,
    readonly retryKind: OllamaRetryKind = 'rate_limited',
  ) {
    super(message)
    this.name = 'RetryableOllamaError'
  }
}

function isRetryableOllamaStatus(status: number, message: string): boolean {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true
  return /rate limit|too many requests|quota|overloaded|unavailable|timeout|timed out|try again|connection/i.test(
    message,
  )
}

function ollamaRetryKind(status: number, message: string): OllamaRetryKind {
  if (status === 408 || status === 504) return 'timeout'
  if (/timeout|timed out|aborted/i.test(message)) return 'timeout'
  return 'rate_limited'
}

const INVALID_JSON_MESSAGE = 'Ollama returned invalid extraction JSON'
function getOllamaHost(): string {
  return (process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST).replace(/\/+$/, '')
}

function getOllamaTimeoutMs(): number {
  const configured = Number(process.env.OLLAMA_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OLLAMA_TIMEOUT_MS
}

function getOllamaTotalTimeoutMs(): number {
  const configured = Number(process.env.OLLAMA_TOTAL_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OLLAMA_TOTAL_TIMEOUT_MS
}

function getOllamaMaxOutputTokens(): number {
  const configured = Number(process.env.OLLAMA_MAX_OUTPUT_TOKENS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OLLAMA_MAX_OUTPUT_TOKENS
}

function getOllamaTemperature(): number {
  const configured = Number(process.env.OLLAMA_TEMPERATURE)
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_OLLAMA_TEMPERATURE
}

function getOllamaModelChain(): string[] {
  const primary = process.env.OLLAMA_VISION_MODEL ?? DEFAULT_OLLAMA_MODEL
  const fallbacks =
    process.env.OLLAMA_VISION_FALLBACK_MODELS?.split(',') ??
    DEFAULT_OLLAMA_FALLBACK_MODELS
  return Array.from(
    new Set([primary, ...fallbacks.map(model => model.trim()).filter(Boolean)]),
  )
}

export class OllamaFormVisionProvider implements FormVisionProvider {
  readonly name = 'ollama'

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractionFields> {
    const host = getOllamaHost()
    const models = getOllamaModelChain()
    const perModelTimeoutMs = getOllamaTimeoutMs()
    const totalTimeoutMs = getOllamaTotalTimeoutMs()
    const startedAt = Date.now()
    const deadline = startedAt + totalTimeoutMs
    const imageBase64 = imageBuffer.toString('base64')
    let lastRetryableError: RetryableOllamaError | undefined

    console.info('[purchase-extract] Ollama extraction start', {
      host,
      models,
      imageBytes: imageBuffer.length,
      mimeType,
      perModelTimeoutMs,
      totalTimeoutMs,
    })

    for (const model of models) {
      const attemptStartedAt = Date.now()
      try {
        const remainingTimeoutMs = deadline - Date.now()
        if (remainingTimeoutMs <= 500) {
          throw new RetryableOllamaError(
            `Ollama extraction reached total timeout after ${Date.now() - startedAt}ms`,
            'timeout',
          )
        }
        const result = await this.requestModel(
          host,
          model,
          imageBase64,
          Math.min(perModelTimeoutMs, remainingTimeoutMs),
        )
        console.info('[purchase-extract] Ollama model succeeded', {
          model,
          durationMs: Date.now() - attemptStartedAt,
          totalDurationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        if (!(error instanceof RetryableOllamaError)) {
          console.warn('[purchase-extract] Ollama model failed', {
            model,
            durationMs: Date.now() - attemptStartedAt,
            retryable: false,
            reason: error instanceof Error ? error.message : String(error),
          })
          throw this.toVisionError(error)
        }
        lastRetryableError = error
        console.warn('[purchase-extract] Ollama model fallback', {
          failedModel: model,
          remainingModels: models.length - models.indexOf(model) - 1,
          durationMs: Date.now() - attemptStartedAt,
          reason: error.message,
        })
      }
    }

    throw this.toVisionError(
      lastRetryableError ?? new Error('Ollama extraction failed'),
    )
  }

  private async requestModel(
    host: string,
    model: string,
    imageBase64: string,
    timeoutMs: number,
  ): Promise<RawExtractionFields> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (process.env.OLLAMA_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`
    }

    let response: Response
    try {
      response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model,
          stream: false,
          options: {
            temperature: getOllamaTemperature(),
            num_predict: getOllamaMaxOutputTokens(),
          },
          messages: [
            { role: 'system', content: OLLAMA_SYSTEM_PROMPT },
            {
              role: 'user',
              content: OLLAMA_USER_INSTRUCTION,
              images: [imageBase64],
            },
          ],
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RetryableOllamaError(
          `Ollama extraction timed out with ${model} after ${timeoutMs}ms`,
          'timeout',
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    const payload = this.parseChatResponse(responseText, response.statusText)
    if (!response.ok) {
      const message = payload.error ?? response.statusText
      const formatted = `Ollama extraction failed with ${model}: ${message}`
      if (isRetryableOllamaStatus(response.status, message)) {
        throw new RetryableOllamaError(
          formatted,
          ollamaRetryKind(response.status, message),
        )
      }
      throw new Error(formatted)
    }

    const content = payload.message?.content?.trim()
    if (!content) throw new Error('Ollama did not return extraction JSON')
    return parseExtractionText(
      content,
      sanitizeRawExtraction,
      INVALID_JSON_MESSAGE,
    )
  }

  private parseChatResponse(
    text: string,
    statusText: string,
  ): OllamaChatResponse {
    if (!text) return {}
    try {
      return JSON.parse(text) as OllamaChatResponse
    } catch {
      throw new Error(`Ollama returned a non-JSON response: ${statusText}`)
    }
  }

  private toVisionError(error: unknown): VisionProviderError {
    if (error instanceof VisionProviderError) return error
    if (error instanceof RetryableOllamaError) {
      return error.retryKind === 'timeout'
        ? new VisionProviderError('timeout', OLLAMA_TIMEOUT_MESSAGE)
        : new VisionProviderError('rate_limited', OLLAMA_RATE_LIMITED_MESSAGE)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (
      /api key|api_key|environment variable|unauthorized|forbidden|not found|not supported|model|401|403|404/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', OLLAMA_CONFIG_MESSAGE)
    }
    if (
      /did not return extraction JSON|invalid extraction JSON|non-JSON/i.test(
        message,
      ) ||
      message === EMPTY_TEXT_EXTRACTION_MESSAGE
    ) {
      return new VisionProviderError('unprocessable', OLLAMA_PARSE_MESSAGE)
    }
    return new VisionProviderError('unprocessable', OLLAMA_GENERIC_MESSAGE)
  }
}
