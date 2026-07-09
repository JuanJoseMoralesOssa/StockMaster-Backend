// Alternative FormVisionProvider backed by Groq's OpenAI-compatible chat API.
// Opt in with FORM_VISION_PROVIDER=groq (Gemini stays the default).
//
// Only Groq's MULTIMODAL models can read the receipt photo. As of 2026-07 those
// are meta-llama/llama-4-scout-17b-16e-instruct (scheduled for shutdown
// 2026-07-17) and qwen/qwen3.6-27b. The flagship TEXT models
// (llama-3.3-70b-versatile, llama-3.1-8b-instant) cannot accept images and must
// NOT be configured here. Unlike Gemini's responseSchema, Groq only guarantees
// JSON *validity* via response_format:{type:'json_object'} — not schema
// conformance — so sanitizeRawExtraction (shared with the Gemini path) still
// salvages/re-types the payload before the normalizer sees it.
//
// This file is self-contained (transport + fallback orchestration in one class)
// because the Groq path is younger and simpler than the three-collaborator
// Gemini one; split it the same way if it grows a local quota guard.

import { RawExtractionFields } from '../form-extraction.normalizer'
import {
  FormVisionProvider,
  VisionProviderError,
} from '../form-extraction.provider'
import { sanitizeRawExtraction } from '../gemini/gemini-transport'
import { PRODUCT_FIELD_LABELS, PRODUCT_FIELDS } from '../form-spec'

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
// qwen3.6-27b is the durable multimodal default (both it and scout verified live
// 2026-07-09: HTTP 200 + valid JSON from an image). llama-4-scout also works
// today but shuts down 2026-07-17, so it is only a short-lived fallback — drop it
// from GROQ_VISION_FALLBACK_MODELS after that date. Both accept image +
// response_format json_object; both overridable via env.
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.6-27b'
const DEFAULT_GROQ_FALLBACK_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
]
const DEFAULT_GROQ_TIMEOUT_MS = 8000
const DEFAULT_GROQ_TOTAL_TIMEOUT_MS = 26000
const GROQ_MAX_OUTPUT_TOKENS = 2048
const GROQ_TEMPERATURE = 0.1

const GROQ_TIMEOUT_MESSAGE =
  'El servicio de lectura del formulario tardó demasiado. Intenta de nuevo.'
const GROQ_RATE_LIMITED_MESSAGE =
  'El servicio de lectura del formulario está ocupado temporalmente. Intenta de nuevo en unos minutos.'
const GROQ_CONFIG_MESSAGE =
  'El servicio de lectura del formulario no está configurado correctamente. Revisa la API key y el modelo (GROQ_VISION_MODEL) del servidor.'
const GROQ_PARSE_MESSAGE =
  'El servicio de visión respondió, pero no devolvió un JSON de extracción válido. Intenta de nuevo o revisa el modelo configurado.'
const GROQ_GENERIC_MESSAGE =
  'No se pudo leer el formulario con el servicio de visión. Intenta de nuevo.'

// Derived from the shared PRODUCT_FIELDS spec so the Groq prompt cannot drift
// from RawExtractionFields / the Gemini schema (form-spec.ts is the single
// source of truth — audit Finding M9).
const PRODUCT_JSON_LINES = PRODUCT_FIELDS.map(
  field =>
    `  "${field}": number|null,   // pounds of ${PRODUCT_FIELD_LABELS[field]} (null if blank/illegible)`,
).join('\n')
const CONFIDENCE_KEYS = [
  'fecha',
  'librasTotal',
  'recibiDelSr',
  ...PRODUCT_FIELDS,
]
  .map(field => `"${field}": number`)
  .join(', ')

const GROQ_SYSTEM_PROMPT = `You are a data extraction assistant for a livestock/hide trading business (J.A.A.G).
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
- If a field is blank or illegible, return null.
- Confidence 1.0 = certain, 0.0 = illegible. If ambiguous, guess and set confidence < 0.7.

Return ONLY a JSON object with EXACTLY these keys and no others:
{
  "fecha": string|null,
  "librasTotal": number|null,
${PRODUCT_JSON_LINES}
  "recibiDelSr": string|null,
  "fieldConfidences": { ${CONFIDENCE_KEYS} }
}`

const GROQ_USER_INSTRUCTION =
  'Extract all handwritten values from this J.A.A.G receipt form. Return only the valid JSON object described above.'

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

type GroqRetryKind = 'timeout' | 'rate_limited'

/** Retryable Groq failure: the fallback chain should try the next model. */
class RetryableGroqError extends Error {
  constructor(
    message: string,
    readonly retryKind: GroqRetryKind = 'rate_limited',
  ) {
    super(message)
    this.name = 'RetryableGroqError'
  }
}

function isRetryableGroqStatus(status: number, message: string): boolean {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true
  return /rate limit|too many requests|quota|overloaded|unavailable|timeout|timed out|try again/i.test(
    message,
  )
}

function groqRetryKind(status: number, message: string): GroqRetryKind {
  if (status === 408 || status === 504) return 'timeout'
  if (/timeout|timed out|aborted/i.test(message)) return 'timeout'
  return 'rate_limited'
}

const INVALID_JSON_MESSAGE = 'Groq returned invalid extraction JSON'

function parseExtractionJson(text: string): RawExtractionFields {
  const trimmed = text.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // response_format:json_object should prevent fences, but a degraded model
    // may still wrap the payload — recover it the same way the Gemini path does.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (!fenced) throw new Error(INVALID_JSON_MESSAGE)
    try {
      parsed = JSON.parse(fenced[1])
    } catch {
      throw new Error(INVALID_JSON_MESSAGE)
    }
  }
  return sanitizeRawExtraction(parsed)
}

function getGroqBaseUrl(): string {
  return (process.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL).replace(
    /\/+$/,
    '',
  )
}

function getGroqTimeoutMs(): number {
  const configured = Number(process.env.GROQ_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GROQ_TIMEOUT_MS
}

function getGroqTotalTimeoutMs(): number {
  const configured = Number(process.env.GROQ_TOTAL_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GROQ_TOTAL_TIMEOUT_MS
}

function getGroqModelChain(): string[] {
  const primary = process.env.GROQ_VISION_MODEL ?? DEFAULT_GROQ_MODEL
  const fallbacks =
    process.env.GROQ_VISION_FALLBACK_MODELS?.split(',') ??
    DEFAULT_GROQ_FALLBACK_MODELS
  return Array.from(
    new Set([primary, ...fallbacks.map(model => model.trim()).filter(Boolean)]),
  )
}

/**
 * Groq-backed vision provider. Mirrors the Gemini provider's contract: on
 * failure it throws a typed {@link VisionProviderError} whose `kind` the
 * provider-agnostic FormExtractionService maps to an HTTP status.
 */
export class GroqFormVisionProvider implements FormVisionProvider {
  readonly name = 'groq'

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractionFields> {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw this.toVisionError(
        new Error('GROQ_API_KEY environment variable is not set'),
      )
    }

    const models = getGroqModelChain()
    const perModelTimeoutMs = getGroqTimeoutMs()
    const totalTimeoutMs = getGroqTotalTimeoutMs()
    const startedAt = Date.now()
    const deadline = startedAt + totalTimeoutMs
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`
    let lastRetryableError: RetryableGroqError | undefined

    console.info('[purchase-extract] Groq extraction start', {
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
          throw new RetryableGroqError(
            `Groq extraction reached total timeout after ${Date.now() - startedAt}ms`,
            'timeout',
          )
        }
        const result = await this.requestModel(
          model,
          dataUrl,
          apiKey,
          Math.min(perModelTimeoutMs, remainingTimeoutMs),
        )
        console.info('[purchase-extract] Groq model succeeded', {
          model,
          durationMs: Date.now() - attemptStartedAt,
          totalDurationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        if (!(error instanceof RetryableGroqError)) {
          console.warn('[purchase-extract] Groq model failed', {
            model,
            durationMs: Date.now() - attemptStartedAt,
            retryable: false,
            reason: error instanceof Error ? error.message : String(error),
          })
          throw this.toVisionError(error)
        }
        lastRetryableError = error
        console.warn('[purchase-extract] Groq model fallback', {
          failedModel: model,
          remainingModels: models.length - models.indexOf(model) - 1,
          durationMs: Date.now() - attemptStartedAt,
          reason: error.message,
        })
      }
    }

    throw this.toVisionError(
      lastRetryableError ?? new Error('Groq extraction failed'),
    )
  }

  /** One chat.completions call against a single Groq model. */
  private async requestModel(
    model: string,
    dataUrl: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<RawExtractionFields> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(`${getGroqBaseUrl()}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: GROQ_TEMPERATURE,
          max_tokens: GROQ_MAX_OUTPUT_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: GROQ_USER_INSTRUCTION },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RetryableGroqError(
          `Groq extraction timed out with ${model} after ${timeoutMs}ms`,
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
      const message = payload.error?.message ?? response.statusText
      const formatted = `Groq extraction failed with ${model}: ${message}`
      if (isRetryableGroqStatus(response.status, message)) {
        throw new RetryableGroqError(
          formatted,
          groqRetryKind(response.status, message),
        )
      }
      throw new Error(formatted)
    }

    const content = payload.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('Groq did not return extraction JSON')
    return parseExtractionJson(content)
  }

  private parseChatResponse(
    text: string,
    statusText: string,
  ): GroqChatResponse {
    if (!text) return {}
    try {
      return JSON.parse(text) as GroqChatResponse
    } catch {
      throw new Error(`Groq returned a non-JSON response: ${statusText}`)
    }
  }

  /** Translates a Groq-layer failure into a typed, agnostic VisionProviderError. */
  private toVisionError(error: unknown): VisionProviderError {
    if (error instanceof VisionProviderError) return error
    if (error instanceof RetryableGroqError) {
      return error.retryKind === 'timeout'
        ? new VisionProviderError('timeout', GROQ_TIMEOUT_MESSAGE)
        : new VisionProviderError('rate_limited', GROQ_RATE_LIMITED_MESSAGE)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (
      /api key|api_key|environment variable is not set|not found|not supported|invalid_api_key|401|403|404|model/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', GROQ_CONFIG_MESSAGE)
    }
    if (
      /did not return extraction JSON|invalid extraction JSON|non-JSON/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', GROQ_PARSE_MESSAGE)
    }
    return new VisionProviderError('unprocessable', GROQ_GENERIC_MESSAGE)
  }
}
