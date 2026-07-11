import {
  normalizeForMatch,
  RawExtractionFields,
} from './form-extraction.normalizer'
import { PRODUCT_FIELDS, ProductField } from './form-spec'

export const EMPTY_TEXT_EXTRACTION_MESSAGE =
  'No recognized extraction fields in OCR text'

// The product lines come from the shared spec, and the two maps below are keyed
// by ProductField, so adding a product to form-spec.ts fails to COMPILE until
// this parser can recognise its key. Before, the parser held a private copy of
// the list: a new product type-checked fine and left every text-based provider
// (Ollama, OCR Space) silently blind to that line (audit Finding H3).
const KEY_VALUE_FIELDS = [
  'fecha',
  'librasTotal',
  'recibiDelSr',
  ...PRODUCT_FIELDS,
] as const
type KeyValueField = (typeof KEY_VALUE_FIELDS)[number]

/**
 * How a product line can be KEYED in OCR text. Distinct from the spec's
 * PRODUCT_ALIASES (which match a product against the DB catalogue): these are
 * the labels a model or an OCR engine prints before the value, so they carry the
 * form's own wording ("libra de sebo") rather than catalogue synonyms.
 */
const PRODUCT_KEY_ALIASES: Record<ProductField, string[]> = {
  pieles: ['pieles', 'skins', 'hides'],
  sebo: ['sebo', 'cebo', 'libra de sebo', 'libra de cebo', 'tallow'],
  hueso: ['hueso', 'bone'],
}

/** Label patterns for the loose path, where OCR lost the ":" separators. */
const PRODUCT_LOOSE_PATTERNS: Record<ProductField, RegExp> = {
  pieles: /pieles/i,
  sebo: /(?:libra\s+de\s+)?[sc]ebo/i,
  hueso: /hueso/i,
}

const FIELD_KEY_ALIASES: Record<KeyValueField, string[]> = {
  fecha: ['fecha', 'date'],
  librasTotal: ['librastotal', 'libras', 'total libras', 'total pounds'],
  recibiDelSr: [
    'recibidelsr',
    'recibidel sr',
    'recibi del sr',
    'recibi del senor',
    'recibi del señor',
    'proveedor',
    'supplier',
    'nombre',
  ],
  ...PRODUCT_KEY_ALIASES,
}

// Order is irrelevant here: labelHits() sorts by position in the text.
const LOOSE_LABELS: Array<{ field: KeyValueField; pattern: RegExp }> = [
  { field: 'fecha', pattern: /fecha/i },
  { field: 'librasTotal', pattern: /libras(?:\s+total)?/i },
  { field: 'recibiDelSr', pattern: /recib[ií]\s+del\s+sr\.?/i },
  ...PRODUCT_FIELDS.map(field => ({
    field,
    pattern: PRODUCT_LOOSE_PATTERNS[field],
  })),
]

function isNullishText(value: string): boolean {
  return /^(|null|n\/a|na|none|blank|empty|vacio|vacío|ilegible|illegible|-|—)$/i.test(
    value.trim(),
  )
}

function parseNumberText(value: string): number | null {
  const trimmed = value.trim()
  if (isNullishText(trimmed)) return null
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed.replace(/,/g, '')
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function parseStringText(value: string): string | null {
  const trimmed = value.trim()
  return isNullishText(trimmed) ? null : trimmed
}

function fieldForKey(rawKey: string): KeyValueField | undefined {
  const normalized = normalizeForMatch(rawKey).replace(/\s+/g, ' ')
  return KEY_VALUE_FIELDS.find(field =>
    FIELD_KEY_ALIASES[field].some(
      alias => normalized === normalizeForMatch(alias),
    ),
  )
}

function emptyExtraction(): RawExtractionFields {
  const productValues = Object.fromEntries(
    PRODUCT_FIELDS.map(field => [field, null]),
  ) as Record<ProductField, number | null>
  const productConfidences = Object.fromEntries(
    PRODUCT_FIELDS.map(field => [field, 0]),
  ) as Record<ProductField, number>

  return {
    fecha: null,
    librasTotal: null,
    recibiDelSr: null,
    ...productValues,
    fieldConfidences: {
      fecha: 0,
      librasTotal: 0,
      recibiDelSr: 0,
      ...productConfidences,
    },
  }
}

function assignField(
  raw: RawExtractionFields,
  field: KeyValueField,
  value: string,
  confidence: number,
): boolean {
  if (field === 'fecha') {
    raw.fecha = parseStringText(value)
    raw.fieldConfidences.fecha = raw.fecha == null ? 0 : confidence
    return raw.fecha != null
  }
  if (field === 'recibiDelSr') {
    raw.recibiDelSr = parseStringText(value)
    raw.fieldConfidences.recibiDelSr = raw.recibiDelSr == null ? 0 : confidence
    return raw.recibiDelSr != null
  }

  const parsed = parseNumberText(value)
  raw[field] = parsed
  raw.fieldConfidences[field] = parsed == null ? 0 : confidence
  return parsed != null
}

function parseKeyValueExtraction(
  text: string,
): RawExtractionFields | undefined {
  const raw = emptyExtraction()
  let recognizedFields = 0

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:=\-]+?)\s*[:=\-]\s*(.*?)\s*$/)
    if (!match) continue
    const field = fieldForKey(match[1])
    if (!field) continue

    recognizedFields += 1
    assignField(raw, field, match[2], 0.8)
  }

  return recognizedFields > 0 ? raw : undefined
}

function labelHits(text: string): Array<{
  field: KeyValueField
  index: number
  end: number
}> {
  const hits: Array<{ field: KeyValueField; index: number; end: number }> = []
  for (const label of LOOSE_LABELS) {
    const match = label.pattern.exec(text)
    if (!match) continue
    hits.push({
      field: label.field,
      index: match.index,
      end: match.index + match[0].length,
    })
  }
  return hits.sort((a, b) => a.index - b.index)
}

function cleanLooseValue(value: string): string {
  return value
    .replace(/^[\s:=\-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLooseLabelExtraction(
  text: string,
): RawExtractionFields | undefined {
  const raw = emptyExtraction()
  const normalizedText = text.replace(/\r/g, '\n')
  const hits = labelHits(normalizedText)
  let recognizedValues = 0

  for (let index = 0; index < hits.length; index += 1) {
    const current = hits[index]
    const next = hits[index + 1]
    const rawValue = normalizedText.slice(
      current.end,
      next?.index ?? normalizedText.length,
    )
    const value = cleanLooseValue(rawValue)
    if (assignField(raw, current.field, value, 0.55)) recognizedValues += 1
  }

  return recognizedValues > 0 ? raw : undefined
}

export function parseExtractionText(
  text: string,
  sanitizeJson: (value: unknown) => RawExtractionFields,
  invalidJsonMessage: string,
): RawExtractionFields {
  const trimmed = text.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
    return sanitizeJson(parsed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1])
        return sanitizeJson(parsed)
      } catch {
        throw new Error(invalidJsonMessage)
      }
    }
  }

  const keyValue = parseKeyValueExtraction(trimmed)
  if (keyValue) return keyValue
  const looseLabels = parseLooseLabelExtraction(trimmed)
  if (looseLabels) return looseLabels
  throw new Error(EMPTY_TEXT_EXTRACTION_MESSAGE)
}
