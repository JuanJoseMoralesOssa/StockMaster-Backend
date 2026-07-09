// Single source of truth for the J.A.A.G purchase form's product-line fields.
//
// The raw-extraction type, the Gemini response schema (gemini-transport.ts), the
// normalizer's alias/label maps (form-extraction.normalizer.ts) and the
// controller's OpenAPI enum (purchase-extract.controller.ts) all DERIVE from
// this one list, so the copies cannot silently drift and produce a runtime
// `undefined` (audit Finding M9). Adding a product line is a single edit here;
// TypeScript then flags every map/type that has not been extended to cover it.

export const PRODUCT_FIELDS = ['pieles', 'sebo', 'hueso'] as const

export type ProductField = (typeof PRODUCT_FIELDS)[number]

/** Display labels for each product field (Spanish, as printed on the form). */
export const PRODUCT_FIELD_LABELS: Record<ProductField, string> = {
  pieles: 'Pieles',
  sebo: 'Sebo',
  hueso: 'Hueso',
}

/** Catalogue-matching aliases per product field. */
export const PRODUCT_ALIASES: Record<ProductField, string[]> = {
  pieles: ['piel', 'pieles', 'hide', 'hides', 'cuero', 'cueros'],
  sebo: ['sebo', 'cebo', 'tallow', 'grasa'],
  hueso: ['hueso', 'huesos', 'bone', 'bones'],
}
