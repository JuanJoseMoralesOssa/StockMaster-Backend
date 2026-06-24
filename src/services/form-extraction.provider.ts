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

const DEFAULT_GEMINI_TIMEOUT_MS = 45000

function getGeminiTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GEMINI_TIMEOUT_MS
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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey)
      throw new Error('GEMINI_API_KEY environment variable is not set')

    const model = process.env.GEMINI_VISION_MODEL ?? 'gemini-3.5-flash'
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
                  inline_data: {
                    mime_type: toSupportedMime(mimeType),
                    data: imageBuffer.toString('base64'),
                  },
                },
                {
                  text: 'Extract all handwritten values from this J.A.A.G receipt form. Return null for any field that is blank or unreadable.',
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            response_mime_type: 'application/json',
            response_schema: FIELD_EXTRACTION_SCHEMA,
          },
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Gemini extraction timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    const payload = parseGeminiResponse(responseText, response.statusText)
    if (!response.ok) {
      throw new Error(
        `Gemini extraction failed: ${payload.error?.message ?? response.statusText}`,
      )
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
