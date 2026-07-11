// Transport seam for a SINGLE Gemini generateContent call: build the request
// body, fetch with an abort timeout, and parse the structured JSON out of the
// response. It knows nothing about the fallback chain or quota accounting —
// that orchestration lives in GeminiFormVisionProvider. Splitting it out keeps
// each concern independently testable (audit Finding 7).

import { RawExtractionFields } from '../form-extraction.normalizer'
import { PRODUCT_FIELDS, ProductField } from '../form-spec'

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
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    totalTokenCount?: number
  }
  error?: {
    message?: string
  }
}

/**
 * Gemini's OFFICIAL token accounting for one call, as reported in
 * `usageMetadata`. This is the only trustworthy cost figure: everything else in
 * this module (see {@link estimateGeminiRequestTokens}) is a local estimate used
 * to pre-screen quota, and the two are NOT interchangeable. Fields are nullable
 * because a degraded/older model may omit the block entirely.
 */
export interface GeminiUsage {
  promptTokens: number | null
  /** Billed output tokens (the JSON answer). */
  outputTokens: number | null
  /** Thinking tokens — billed as output, and invisible in the answer itself. */
  thoughtsTokens: number | null
  totalTokens: number | null
}

/** One successful model call: the extracted fields plus what it actually cost. */
export interface GeminiModelResult {
  fields: RawExtractionFields
  usage: GeminiUsage
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

/** Reads the provider's official usage block; absent/garbled counts stay null. */
export function readGeminiUsage(
  response: GeminiGenerateContentResponse,
): GeminiUsage {
  const usage = response.usageMetadata
  return {
    promptTokens: tokenCount(usage?.promptTokenCount),
    outputTokens: tokenCount(usage?.candidatesTokenCount),
    thoughtsTokens: tokenCount(usage?.thoughtsTokenCount),
    totalTokens: tokenCount(usage?.totalTokenCount),
  }
}

export type GeminiRetryKind = 'timeout' | 'rate_limited'

/**
 * Whether a failed attempt actually reached Gemini — i.e. whether it burned
 * REMOTE quota. A request that died before dispatch (missing API key, local
 * quota guard) costs nothing and may be refunded to the local counters; one that
 * was dispatched costs a request against Gemini's RPM/RPD even if we aborted
 * before reading the answer, so refunding it would make the local guard
 * over-permit and invite 429s (audit Finding H6).
 */
export function consumedRemoteQuota(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Partial<{ dispatched: boolean }>).dispatched === true
  )
}

/**
 * Thrown when a model call fails in a way the fallback chain should retry.
 * `retryKind` preserves WHY it is retryable (a deadline vs. an upstream
 * rate-limit) as a TYPE, so the provider can map it to the right domain error
 * without re-parsing the human-readable message. `dispatched` says whether the
 * request reached Gemini; it defaults to false because the provider raises this
 * error for purely local rejections (quota guard, deadline) that never leave the
 * process — the transport sets it explicitly when a real request was sent.
 */
export class RetryableGeminiError extends Error {
  constructor(
    message: string,
    readonly retryKind: GeminiRetryKind = 'rate_limited',
    readonly dispatched: boolean = false,
  ) {
    super(message)
    this.name = 'RetryableGeminiError'
  }
}

/**
 * A non-retryable failure of one model call (bad request, unparseable answer,
 * missing API key). Carries `dispatched` for the same quota-accounting reason as
 * {@link RetryableGeminiError}; the message is preserved verbatim so the
 * provider's classification keeps working.
 */
export class GeminiCallError extends Error {
  constructor(
    message: string,
    readonly dispatched: boolean,
  ) {
    super(message)
    this.name = 'GeminiCallError'
  }
}

/**
 * The HTTP client hung up (the user left the scan screen, or its own deadline
 * fired) while a model call was in flight. The chain must stop immediately:
 * every further model would be billed for an answer nobody will read.
 */
export class ClientAbortedError extends Error {
  readonly dispatched = true

  constructor(model: string) {
    super(`El cliente canceló la extracción durante la llamada a ${model}`)
    this.name = 'ClientAbortedError'
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

/**
 * PRE-FLIGHT estimate, used only to decide whether a call is worth attempting
 * against the local TPM guard. It is NOT a cost figure: once the call returns,
 * `usageMetadata` carries the provider's official count and the quota tracker
 * trues the reservation up (see GeminiQuotaTracker.settle).
 */
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

const INVALID_JSON_MESSAGE = 'Gemini returned invalid extraction JSON'

function coerceNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    // A degraded model may emit "50,5" (Colombian decimal comma) as a string.
    const parsed = Number(value.trim().replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function coerceText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function clamp01(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

/**
 * Post-parse type guard. The responseSchema usually guarantees the shape, but a
 * degraded model can still emit strings in numeric fields, junk types, or
 * confidences out of range. Salvage what coerces cleanly and null the rest so
 * the normalizer never sees a mistyped value; a missing confidence falls back
 * to the normalizer's 0.5 default, which flags the field for review.
 */
export function sanitizeRawExtraction(value: unknown): RawExtractionFields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID_JSON_MESSAGE)
  }
  const record = value as Record<string, unknown>
  const rawConfidences =
    typeof record.fieldConfidences === 'object' &&
    record.fieldConfidences !== null
      ? (record.fieldConfidences as Record<string, unknown>)
      : {}

  const fieldConfidences = Object.fromEntries(
    ['fecha', 'librasTotal', 'recibiDelSr', ...PRODUCT_FIELDS]
      .map(field => [field, clamp01(rawConfidences[field])] as const)
      .filter(([, confidence]) => confidence !== undefined),
  ) as RawExtractionFields['fieldConfidences']

  const productValues = Object.fromEntries(
    PRODUCT_FIELDS.map(field => [field, coerceNumeric(record[field])]),
  ) as Record<ProductField, number | null>

  return {
    fecha: coerceText(record.fecha),
    librasTotal: coerceNumeric(record.librasTotal),
    recibiDelSr: coerceText(record.recibiDelSr),
    fieldConfidences,
    ...productValues,
  }
}

function parseExtractionJson(text: string): RawExtractionFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (!fenced) throw new Error(INVALID_JSON_MESSAGE)
    try {
      parsed = JSON.parse(fenced[1])
    } catch {
      throw new Error(INVALID_JSON_MESSAGE)
    }
  }
  return sanitizeRawExtraction(parsed)
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
  /**
   * @param clientSignal aborts the call when the HTTP client that asked for the
   * extraction hangs up. Distinguishing it from our own `timeoutMs` deadline
   * matters: a deadline means "try the next model", a client hang-up means
   * "stop — nobody is waiting for the answer".
   */
  async requestModel(
    model: string,
    imageBuffer: Buffer,
    mimeType: string,
    mediaResolution: string,
    timeoutMs: number,
    clientSignal?: AbortSignal,
  ): Promise<GeminiModelResult> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey)
      throw new GeminiCallError(
        'GEMINI_API_KEY environment variable is not set',
        false,
      )

    if (clientSignal?.aborted) throw new ClientAbortedError(model)

    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    // Forwarding beats AbortSignal.any() here: it keeps the two abort causes
    // distinguishable (the flag below) and works on every supported Node.
    const forwardClientAbort = () => controller.abort()
    clientSignal?.addEventListener('abort', forwardClientAbort, { once: true })

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
        // The request DID leave the process, so Gemini has already counted it
        // against the remote quota — both errors below are `dispatched`.
        if (clientSignal?.aborted) throw new ClientAbortedError(model)
        throw new RetryableGeminiError(
          `Gemini extraction timed out with ${model} after ${timeoutMs}ms`,
          'timeout',
          true,
        )
      }
      // A connection-level failure (DNS, TLS, socket): the call never landed.
      throw new GeminiCallError(
        `Gemini extraction failed with ${model}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
      )
    } finally {
      clearTimeout(timeout)
      clientSignal?.removeEventListener('abort', forwardClientAbort)
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
          true,
        )
      }
      throw new GeminiCallError(formattedMessage, true)
    }

    // A malformed answer still consumed the call: keep `dispatched` true so the
    // local quota guard does not hand the budget back.
    try {
      return {
        fields: parseExtractionJson(extractJsonText(payload)),
        usage: readGeminiUsage(payload),
      }
    } catch (error) {
      throw new GeminiCallError(
        error instanceof Error ? error.message : String(error),
        true,
      )
    }
  }
}
