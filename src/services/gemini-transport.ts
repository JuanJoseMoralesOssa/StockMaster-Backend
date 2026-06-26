// Transport seam for a SINGLE Gemini generateContent call: build the request
// body, fetch with an abort timeout, and parse the structured JSON out of the
// response. It knows nothing about the fallback chain or quota accounting —
// that orchestration lives in GeminiFormVisionProvider. Splitting it out keeps
// each concern independently testable (audit Finding 7).

import { RawExtractionFields } from './form-extraction.normalizer'
import { PRODUCT_FIELDS, ProductField } from './form-spec'

const SUPPORTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const
type SupportedMime = (typeof SUPPORTED_MIME)[number]

function toSupportedMime(mimeType: string): SupportedMime {
  return SUPPORTED_MIME.includes(mimeType as SupportedMime)
    ? (mimeType as SupportedMime)
    : 'image/jpeg'
}

const SYSTEM_PROMPT = `You are a data extraction assistant for a livestock/hide trading business (J.A.A.G).
You receive photos of handwritten receipt forms and extract the values from specific labeled fields.

The form has these printed labels (in Spanish), each with a blank line where a value is handwritten:
- "Fecha:" -> date
- "LIBRAS" -> total pounds (optional cross-check total, may be blank)
- "PIELES" -> pounds of skins/hides
- "Recibí del Sr." -> supplier/person name
- "Libra de Sebo" -> pounds of tallow (sebo or cebo)
- "Hueso" -> pounds of bone
- "Firma:" -> signature box (IGNORE this)

Rules:
- Extract ONLY what is handwritten. Do not invent values.
- Numbers may use comma as decimal separator (Colombian format): treat "1.234,5" and "1234.5" as the same value.
- If a field is blank, return null.
- If handwriting is ambiguous, return your best guess and set confidence < 0.7.
- Confidence 1.0 = certain, 0.0 = completely illegible.`

// Per-field OCR hints. Keyed by ProductField so adding a product line to the
// shared spec forces a description here too — the schema cannot drift from the
// RawExtractionFields type (audit Finding M9).
const PRODUCT_FIELD_DESCRIPTIONS: Record<ProductField, string> = {
  pieles:
    'The numeric value written after "PIELES" label. Pounds of skins. Use period as decimal separator. Return null if blank or illegible.',
  sebo: 'The numeric value written after "Libra de Sebo" label (may appear as Sebo or Cebo). Pounds of tallow. Return null if blank or illegible.',
  hueso:
    'The numeric value written after "Hueso" label. Pounds of bone. Return null if blank or illegible.',
}

const productFieldSchemas: Record<string, unknown> = Object.fromEntries(
  PRODUCT_FIELDS.map(field => [
    field,
    {
      type: 'number',
      description: PRODUCT_FIELD_DESCRIPTIONS[field],
      nullable: true,
    },
  ]),
)

const productConfidenceSchemas: Record<string, unknown> = Object.fromEntries(
  PRODUCT_FIELDS.map(field => [field, { type: 'number' }]),
)

const FIELD_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    fecha: {
      type: 'string',
      description:
        'The date written after "Fecha:" label. Return as-is from the form (e.g. "14/12/25", "14-12-2025"). Return null if blank or illegible.',
      nullable: true,
    },
    librasTotal: {
      type: 'number',
      description:
        'The numeric value written after "LIBRAS" label. This is the total pounds. Use period as decimal separator. Return null if blank or illegible.',
      nullable: true,
    },
    ...productFieldSchemas,
    recibiDelSr: {
      type: 'string',
      description:
        'The name written after "Recibí del Sr." label. This is the supplier name. Return null if blank or illegible.',
      nullable: true,
    },
    fieldConfidences: {
      type: 'object',
      description: 'Confidence score 0-1 for each extracted field.',
      properties: {
        fecha: { type: 'number' },
        librasTotal: { type: 'number' },
        ...productConfidenceSchemas,
        recibiDelSr: { type: 'number' },
      },
      required: ['fecha', 'librasTotal', ...PRODUCT_FIELDS, 'recibiDelSr'],
    },
  },
  required: [
    'fecha',
    'librasTotal',
    ...PRODUCT_FIELDS,
    'recibiDelSr',
    'fieldConfidences',
  ],
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
  error?: {
    message?: string
  }
}

export type GeminiRetryKind = 'timeout' | 'rate_limited'

/**
 * Thrown when a model call fails in a way the fallback chain should retry.
 * `retryKind` preserves WHY it is retryable (a deadline vs. an upstream
 * rate-limit) as a TYPE, so the provider can map it to the right domain error
 * without re-parsing the human-readable message.
 */
export class RetryableGeminiError extends Error {
  constructor(
    message: string,
    readonly retryKind: GeminiRetryKind = 'rate_limited',
  ) {
    super(message)
    this.name = 'RetryableGeminiError'
  }
}

/** Classifies a retryable HTTP failure as a timeout vs. a rate-limit/availability one. */
export function geminiRetryKind(
  status: number,
  message: string,
): GeminiRetryKind {
  if (status === 408 || status === 504) return 'timeout'
  if (/timeout|timed out|DEADLINE_EXCEEDED/i.test(message)) return 'timeout'
  return 'rate_limited'
}

function getGeminiThinkingLevel(model: string): string | undefined {
  if (model === 'gemini-3.5-flash') return 'MEDIUM'
  if (model === 'gemini-3-flash-preview') return 'LOW'
  if (model === 'gemini-3.1-flash-lite') return 'LOW'
  return undefined
}

function getGeminiMaxOutputTokens(model: string): number {
  if (model === 'gemini-3.1-flash-lite') return 2048
  if (model === 'gemini-2.5-flash-lite') return 2048
  if (model.startsWith('gemma-')) return 2048
  return 4096
}

function buildGenerationConfig(
  model: string,
  mediaResolution: string,
): Record<string, unknown> {
  const thinkingLevel = getGeminiThinkingLevel(model)
  const config: Record<string, unknown> = {
    mediaResolution,
    maxOutputTokens: getGeminiMaxOutputTokens(model),
    responseMimeType: 'application/json',
    responseSchema: FIELD_EXTRACTION_SCHEMA,
  }

  if (thinkingLevel) {
    config.thinkingConfig = { thinkingLevel }
  }

  return config
}

/** Rough request-token estimate for the local quota guard. */
export function estimateGeminiRequestTokens(mediaResolution: string): number {
  const visualTokens =
    {
      MEDIA_RESOLUTION_LOW: 280,
      MEDIA_RESOLUTION_MEDIUM: 560,
      MEDIA_RESOLUTION_HIGH: 1120,
      MEDIA_RESOLUTION_ULTRA_HIGH: 2240,
    }[mediaResolution] ?? 1120

  // Prompt + schema are small compared with the 250K TPM quota, but reserving
  // extra room keeps the local guard conservative.
  return visualTokens + 1500
}

export function isRetryableGeminiFailure(
  status: number,
  message: string,
): boolean {
  if ([408, 429, 503, 504].includes(status)) return true
  return /RESOURCE_EXHAUSTED|quota exceeded|rate limit|UNAVAILABLE|DEADLINE_EXCEEDED|timeout|timed out|try again later/i.test(
    message,
  )
}

function extractJsonText(response: GeminiGenerateContentResponse): string {
  const text = response.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim()

  if (!text) throw new Error('Gemini did not return extraction JSON')
  return text
}

function parseExtractionJson(text: string): RawExtractionFields {
  try {
    return JSON.parse(text) as RawExtractionFields
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (!fenced) throw new Error('Gemini returned invalid extraction JSON')
    return JSON.parse(fenced[1]) as RawExtractionFields
  }
}

function parseGeminiResponse(
  text: string,
  statusText: string,
): GeminiGenerateContentResponse {
  if (!text) return {}
  try {
    return JSON.parse(text) as GeminiGenerateContentResponse
  } catch {
    throw new Error(`Gemini returned a non-JSON response: ${statusText}`)
  }
}

/** Performs one generateContent call against a single Gemini model. */
export class GeminiTransport {
  async requestModel(
    model: string,
    imageBuffer: Buffer,
    mimeType: string,
    mediaResolution: string,
    timeoutMs: number,
  ): Promise<RawExtractionFields> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey)
      throw new Error('GEMINI_API_KEY environment variable is not set')

    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Extract all handwritten values from this J.A.A.G receipt form. Return only valid JSON. Return null for any field that is blank or unreadable.',
                },
                {
                  inline_data: {
                    mime_type: toSupportedMime(mimeType),
                    data: imageBuffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: buildGenerationConfig(model, mediaResolution),
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RetryableGeminiError(
          `Gemini extraction timed out with ${model} after ${timeoutMs}ms`,
          'timeout',
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    const payload = parseGeminiResponse(responseText, response.statusText)
    if (!response.ok) {
      const message = payload.error?.message ?? response.statusText
      const formattedMessage = `Gemini extraction failed with ${model}: ${message}`
      if (isRetryableGeminiFailure(response.status, message)) {
        throw new RetryableGeminiError(
          formattedMessage,
          geminiRetryKind(response.status, message),
        )
      }
      throw new Error(formattedMessage)
    }

    return parseExtractionJson(extractJsonText(payload))
  }
}
