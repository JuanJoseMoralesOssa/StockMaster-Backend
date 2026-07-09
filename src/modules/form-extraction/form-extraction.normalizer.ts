// Pure domain logic for normalising a scanned J.A.A.G form into a purchase prefill.
// Kept free of any I/O (no LLM/Google dependency) so it can be unit-tested directly.

import {
  PRODUCT_ALIASES,
  PRODUCT_FIELD_LABELS,
  PRODUCT_FIELDS,
  ProductField,
} from './form-spec'

// The product-line fields are derived from the shared PRODUCT_FIELDS spec via
// `Record<ProductField, …>`, so adding a field to the spec forces this type (and
// every map below) to cover it — no silent drift with the Gemini schema.
export type RawExtractionFields = {
  fecha: string | null
  librasTotal: number | null
  recibiDelSr: string | null
  fieldConfidences: {
    fecha: number
    librasTotal: number
    recibiDelSr: number
  } & Record<ProductField, number>
} & Record<ProductField, number | null>

export interface ExtractedDetail {
  fieldName: ProductField
  productId: number | undefined
  productName: string
  weightLb: number
  weightKg: number
  confidence: number
  needsReview: boolean
}

export interface SupplierMatch {
  rawName: string | null
  personId: number | undefined
  confidence: number
  needsReview: boolean
  candidates: Array<{ id: number; name: string; score: number }>
}

export interface ExtractionResult {
  date: { value: string | null; confidence: number; needsReview: boolean }
  librasTotal: { value: number | null; confidence: number }
  supplier: SupplierMatch
  details: ExtractedDetail[]
  totalWeightCheck: {
    passed: boolean
    formTotalLb: number | null
    sumLb: number
  }
  needsReview: boolean
  reviewReasons: string[]
}

export const LB_TO_KG = 0.45359237
export const SUPPLIER_MATCH_THRESHOLD = 0.75
export const FIELD_CONFIDENCE_THRESHOLD = 0.7
export const TOTAL_TOLERANCE = 0.05

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) {
    dp[i] = []
    for (let j = 0; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i : 0
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Similarity score 0-1 between a query name and a candidate name. */
export function supplierMatchScore(query: string, candidate: string): number {
  const q = normalizeForMatch(query)
  const c = normalizeForMatch(candidate)
  if (q === '' || c === '') return 0
  if (q === c) return 1
  const dist = levenshtein(q, c)
  const maxLen = Math.max(q.length, c.length)
  const similarity = 1 - dist / maxLen
  const containsBonus = c.includes(q) || q.includes(c) ? 0.1 : 0
  return Math.min(1, similarity + containsBonus)
}

export function matchSupplier(
  rawName: string | null,
  people: Array<{ id: number; name: string }>,
): SupplierMatch {
  if (!rawName || rawName.trim() === '') {
    return {
      rawName,
      personId: undefined,
      confidence: 0,
      needsReview: true,
      candidates: [],
    }
  }

  const scored = people
    .map(p => ({
      id: p.id,
      name: p.name,
      score: supplierMatchScore(rawName, p.name),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const best = scored[0]
  if (!best) {
    return {
      rawName,
      personId: undefined,
      confidence: 0,
      needsReview: true,
      candidates: [],
    }
  }

  return {
    rawName,
    personId: best.score >= SUPPLIER_MATCH_THRESHOLD ? best.id : undefined,
    confidence: best.score,
    needsReview: best.score < SUPPLIER_MATCH_THRESHOLD,
    candidates: scored,
  }
}

/** Parse a handwritten date (DD/MM/YYYY or DD/MM/YY, with /, - or . separators) to ISO. */
export function parseDate(raw: string | null): {
  value: string | null
  confidence: number
  needsReview: boolean
} {
  if (!raw) return { value: null, confidence: 0, needsReview: true }

  const match = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (!match) return { value: null, confidence: 0.3, needsReview: true }

  const [, dayStr, monthStr, yearStr] = match
  const day = parseInt(dayStr, 10)
  const month = parseInt(monthStr, 10)
  let year = parseInt(yearStr, 10)
  if (year < 100) year += 2000

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return { value: null, confidence: 0.2, needsReview: true }
  }

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(iso)
  if (isNaN(parsed.getTime()))
    return { value: null, confidence: 0.2, needsReview: true }

  return { value: iso, confidence: 0.95, needsReview: false }
}

export { PRODUCT_ALIASES } from './form-spec'

export function matchProduct(
  field: ProductField,
  products: Array<{ id: number; name: string }>,
): { id: number; name: string } | undefined {
  const aliases = PRODUCT_ALIASES[field]
  const normProducts = products.map(p => ({
    ...p,
    norm: normalizeForMatch(p.name),
  }))
  for (const alias of aliases) {
    const found = normProducts.find(
      p => p.norm.includes(alias) || alias.includes(p.norm),
    )
    if (found) return { id: found.id, name: found.name }
  }
  return undefined
}

const FIELD_MAP: Array<{ field: ProductField; label: string }> =
  PRODUCT_FIELDS.map(field => ({ field, label: PRODUCT_FIELD_LABELS[field] }))

/** Round to 3 decimals (kg precision). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Convert the raw extracted fields plus the catalogues into a normalised prefill,
 * with per-field confidence, supplier/product matching, lb→kg, and a soft total check.
 */
export function normalize(
  raw: RawExtractionFields,
  people: Array<{ id: number; name: string }>,
  products: Array<{ id: number; name: string }>,
): ExtractionResult {
  const reviewReasons: string[] = []

  const date = parseDate(raw.fecha)
  if (date.needsReview) reviewReasons.push('Fecha no reconocida o ilegible')

  const supplier = matchSupplier(raw.recibiDelSr, people)
  if (supplier.needsReview)
    reviewReasons.push('Proveedor no identificado con confianza')

  const details: ExtractedDetail[] = []
  for (const { field, label } of FIELD_MAP) {
    const valueLb = raw[field]
    if (valueLb == null) continue

    const confidence = raw.fieldConfidences?.[field] ?? 0.5
    const needsReview = confidence < FIELD_CONFIDENCE_THRESHOLD

    const product = matchProduct(field, products)
    if (!product)
      reviewReasons.push(`Producto ${label} no encontrado en el catálogo`)

    details.push({
      fieldName: field,
      productId: product?.id,
      productName: product?.name ?? label,
      weightLb: valueLb,
      weightKg: round3(valueLb * LB_TO_KG),
      confidence,
      needsReview,
    })

    if (needsReview) reviewReasons.push(`Campo ${label} con baja confianza`)
  }

  const sumLb = details.reduce((acc, d) => acc + d.weightLb, 0)
  const formTotalLb = raw.librasTotal
  const totalWeightCheck = {
    passed:
      formTotalLb == null ||
      Math.abs(formTotalLb - sumLb) <= sumLb * TOTAL_TOLERANCE,
    formTotalLb,
    sumLb: round3(sumLb),
  }
  if (!totalWeightCheck.passed) {
    reviewReasons.push(
      `Total de libras no coincide: formulario=${formTotalLb}, suma=${sumLb.toFixed(2)}`,
    )
  }

  if (details.length === 0)
    reviewReasons.push('No se detectaron valores de productos')

  return {
    date,
    librasTotal: {
      value: formTotalLb,
      confidence: raw.fieldConfidences?.librasTotal ?? 0.5,
    },
    supplier,
    details,
    totalWeightCheck,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  }
}
