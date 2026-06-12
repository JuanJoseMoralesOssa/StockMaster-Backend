// Vision-provider seam for reading a J.A.A.G form photo into raw fields.
// The provider only does OCR/vision → RawExtractionFields; all domain logic
// (matching, lb→kg, totals) lives in form-extraction.normalizer.ts.
//
// Swap providers via the FORM_VISION_PROVIDER env var ("claude" | "gemini").
// Claude is the default; Gemini is stubbed as the alternative implementation.

import Anthropic from '@anthropic-ai/sdk'
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
- "Fecha:" → date
- "LIBRAS" → total pounds (optional cross-check total, may be blank)
- "PIELES" → pounds of skins/hides
- "Recibí del Sr." → supplier/person name
- "Libra de Sebo" → pounds of tallow (sebo or cebo)
- "Hueso" → pounds of bone
- "Firma:" → signature box (IGNORE this)

Rules:
- Extract ONLY what is handwritten. Do not invent values.
- Numbers may use comma as decimal separator (Colombian format): treat "1.234,5" and "1234.5" as the same value.
- If a field is blank, return null.
- If handwriting is ambiguous, return your best guess and set confidence < 0.7.
- Confidence 1.0 = certain, 0.0 = completely illegible.`

const FIELD_EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_jaag_form',
  description:
    'Extract all handwritten values from a J.A.A.G receipt form. The form has printed labels with blank lines where values are written by hand.',
  input_schema: {
    type: 'object' as const,
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
  },
}

/** Default provider: Anthropic Claude with forced tool use for guaranteed-shape JSON. */
export class ClaudeFormVisionProvider implements FormVisionProvider {
  readonly name = 'claude'
  private clientInstance: Anthropic | undefined

  private get client(): Anthropic {
    if (!this.clientInstance) {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey)
        throw new Error('ANTHROPIC_API_KEY environment variable is not set')
      this.clientInstance = new Anthropic({ apiKey })
    }
    return this.clientInstance
  }

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractionFields> {
    const message = await this.client.messages.create({
      model: process.env.ANTHROPIC_VISION_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [FIELD_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_jaag_form' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: toSupportedMime(mimeType),
                data: imageBuffer.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Extract all handwritten values from this J.A.A.G receipt form. Return null for any field that is blank or unreadable.',
            },
          ],
        },
      ],
    })

    const toolUse = message.content.find(b => b.type === 'tool_use') as
      | Anthropic.ToolUseBlock
      | undefined
    if (!toolUse) throw new Error('Claude did not return a tool use block')
    return toolUse.input as RawExtractionFields
  }
}

/**
 * Alternative provider seam. Not implemented yet — switching to Gemini means
 * implementing readForm() here (Google GenAI SDK + responseSchema) and setting
 * FORM_VISION_PROVIDER=gemini. The rest of the pipeline (normalizer) is unchanged.
 */
export class GeminiFormVisionProvider implements FormVisionProvider {
  readonly name = 'gemini'

  async readForm(): Promise<RawExtractionFields> {
    throw new Error(
      'Gemini provider not implemented yet. Set FORM_VISION_PROVIDER=claude or implement GeminiFormVisionProvider.',
    )
  }
}

/** Select the vision provider from env (default: claude). */
export function createFormVisionProvider(): FormVisionProvider {
  const choice = (process.env.FORM_VISION_PROVIDER ?? 'claude').toLowerCase()
  switch (choice) {
    case 'gemini':
      return new GeminiFormVisionProvider()
    case 'claude':
    default:
      return new ClaudeFormVisionProvider()
  }
}
