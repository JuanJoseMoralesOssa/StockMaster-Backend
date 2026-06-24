// Vision-provider seam for reading a J.A.A.G form photo into raw fields.
// The provider only does OCR/vision -> RawExtractionFields; all domain logic
// (matching, lb->kg, totals) lives in form-extraction.normalizer.ts.
//
// Swap providers via the FORM_VISION_PROVIDER env var. Gemini is the default.

import { RawExtractionFields } from './form-extraction.normalizer'

export interface FormVisionProvider {
  /** Human-readable provider id, for logging/telemetry. */
  readonly name: string
  /** Read the handwritten fields off a form image. */
  readForm(imageBuffer: Buffer, mimeType: string): Promise<RawExtractionFields>
}

export const FORM_VISION_PROVIDER_BINDING = 'services.FormVisionProvider'

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
    pieles: {
      type: 'number',
      description:
        'The numeric value written after "PIELES" label. Pounds of skins. Use period as decimal separator. Return null if blank or illegible.',
      nullable: true,
    },
    sebo: {
      type: 'number',
      description:
        'The numeric value written after "Libra de Sebo" label (may appear as Sebo or Cebo). Pounds of tallow. Return null if blank or illegible.',
      nullable: true,
    },
    hueso: {
      type: 'number',
      description:
        'The numeric value written after "Hueso" label. Pounds of bone. Return null if blank or illegible.',
      nullable: true,
    },
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
        pieles: { type: 'number' },
        sebo: { type: 'number' },
        hueso: { type: 'number' },
        recibiDelSr: { type: 'number' },
      },
      required: [
        'fecha',
        'librasTotal',
        'pieles',
        'sebo',
        'hueso',
        'recibiDelSr',
      ],
    },
  },
  required: [
    'fecha',
    'librasTotal',
    'pieles',
    'sebo',
    'hueso',
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

const DEFAULT_GEMINI_TIMEOUT_MS = 20000
const DEFAULT_GEMINI_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH'
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'
const DEFAULT_GEMINI_FALLBACK_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]

interface GeminiModelLimit {
  rpm: number
  tpm: number
  rpd: number
}

const DEFAULT_GEMINI_MODEL_LIMIT: GeminiModelLimit = {
  rpm: 5,
  tpm: 250000,
  rpd: 20,
}

const GEMINI_MODEL_LIMITS: Record<string, GeminiModelLimit> = {
  'gemini-3.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemma-4-31b-it': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemma-4-26b-a4b-it': { rpm: 5, tpm: 250000, rpd: 20 },
}

interface GeminiQuotaWindow {
  minuteStartedAt: number
  minuteRequests: number
  minuteTokens: number
  dayStartedAt: number
  dayRequests: number
}

const geminiQuotaWindows = new Map<string, GeminiQuotaWindow>()
const ONE_MINUTE_MS = 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

class RetryableGeminiError extends Error {}

function getGeminiTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GEMINI_TIMEOUT_MS
}

function getGeminiMediaResolution(): string {
  return process.env.GEMINI_MEDIA_RESOLUTION ?? DEFAULT_GEMINI_MEDIA_RESOLUTION
}

function getGeminiModelChain(): string[] {
  const primaryModel = process.env.GEMINI_VISION_MODEL ?? DEFAULT_GEMINI_MODEL
  const configuredFallbacks =
    process.env.GEMINI_VISION_FALLBACK_MODELS?.split(',') ??
    DEFAULT_GEMINI_FALLBACK_MODELS

  return Array.from(
    new Set([
      primaryModel,
      ...configuredFallbacks.map(model => model.trim()).filter(Boolean),
    ]),
  )
}

function getGeminiModelLimit(model: string): GeminiModelLimit {
  return GEMINI_MODEL_LIMITS[model] ?? DEFAULT_GEMINI_MODEL_LIMIT
}

function getGeminiThinkingLevel(model: string): string | undefined {
  if (model === 'gemini-3.5-flash') return 'medium'
  if (model === 'gemini-3-flash-preview') return 'low'
  if (model === 'gemini-3.1-flash-lite') return 'low'
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

function estimateGeminiRequestTokens(mediaResolution: string): number {
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

function getQuotaWindow(model: string, now: number): GeminiQuotaWindow {
  const existing = geminiQuotaWindows.get(model)
  if (!existing) {
    const created = {
      minuteStartedAt: now,
      minuteRequests: 0,
      minuteTokens: 0,
      dayStartedAt: now,
      dayRequests: 0,
    }
    geminiQuotaWindows.set(model, created)
    return created
  }

  if (now - existing.minuteStartedAt >= ONE_MINUTE_MS) {
    existing.minuteStartedAt = now
    existing.minuteRequests = 0
    existing.minuteTokens = 0
  }
  if (now - existing.dayStartedAt >= ONE_DAY_MS) {
    existing.dayStartedAt = now
    existing.dayRequests = 0
  }

  return existing
}

function reserveGeminiModelQuota(
  model: string,
  estimatedTokens: number,
): { ok: true } | { ok: false; reason: string; limit: GeminiModelLimit } {
  const now = Date.now()
  const limit = getGeminiModelLimit(model)
  const window = getQuotaWindow(model, now)

  if (window.minuteRequests >= limit.rpm) {
    return {
      ok: false,
      limit,
      reason: `${model} alcanzó su límite local de ${limit.rpm} RPM`,
    }
  }
  if (window.dayRequests >= limit.rpd) {
    return {
      ok: false,
      limit,
      reason: `${model} alcanzó su límite local de ${limit.rpd} RPD`,
    }
  }
  if (window.minuteTokens + estimatedTokens > limit.tpm) {
    return {
      ok: false,
      limit,
      reason: `${model} alcanzó su límite local estimado de ${limit.tpm} TPM`,
    }
  }

  window.minuteRequests += 1
  window.dayRequests += 1
  window.minuteTokens += estimatedTokens
  return { ok: true }
}

function isRetryableGeminiFailure(status: number, message: string): boolean {
  if ([429, 503].includes(status)) return true
  return /RESOURCE_EXHAUSTED|quota exceeded|rate limit|UNAVAILABLE|try again later/i.test(
    message,
  )
}

export function resetGeminiModelQuotaForTests() {
  geminiQuotaWindows.clear()
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

/** Default provider: Google Gemini with structured JSON output. */
export class GeminiFormVisionProvider implements FormVisionProvider {
  readonly name = 'gemini'

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractionFields> {
    const models = getGeminiModelChain()
    const mediaResolution = getGeminiMediaResolution()
    const estimatedTokens = estimateGeminiRequestTokens(mediaResolution)
    let lastRetryableError: RetryableGeminiError | undefined

    for (const model of models) {
      try {
        const quota = reserveGeminiModelQuota(model, estimatedTokens)
        if (!quota.ok) {
          throw new RetryableGeminiError(quota.reason)
        }
        return await this.readFormWithModel(
          model,
          imageBuffer,
          mimeType,
          mediaResolution,
        )
      } catch (error) {
        if (!(error instanceof RetryableGeminiError)) throw error
        lastRetryableError = error
        console.warn('[purchase-extract] Gemini model fallback', {
          failedModel: model,
          remainingModels: models.length - models.indexOf(model) - 1,
          reason: error.message,
        })
      }
    }

    throw lastRetryableError ?? new Error('Gemini extraction failed')
  }

  private async readFormWithModel(
    model: string,
    imageBuffer: Buffer,
    mimeType: string,
    mediaResolution: string,
  ): Promise<RawExtractionFields> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey)
      throw new Error('GEMINI_API_KEY environment variable is not set')

    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    )
    const timeoutMs = getGeminiTimeoutMs()
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
        throw new Error(`Gemini extraction timed out after ${timeoutMs}ms`)
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
        throw new RetryableGeminiError(formattedMessage)
      }
      throw new Error(formattedMessage)
    }

    return parseExtractionJson(extractJsonText(payload))
  }
}

/** Select the vision provider from env (default: gemini). */
export function createFormVisionProvider(): FormVisionProvider {
  const choice = (process.env.FORM_VISION_PROVIDER ?? 'gemini').toLowerCase()
  switch (choice) {
    case 'gemini':
    default:
      return new GeminiFormVisionProvider()
  }
}
