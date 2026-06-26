import { SchemaObject } from '@loopback/rest'

/**
 * Strictly-positive weight constraint for `requestBody` validation, shared by
 * the `with-details` and single-detail PUT schemas so a non-positive weight is
 * rejected at the schema layer with a consistent 422 (matching the
 * `PurchaseDetails`/`ExpenseDetails` model schema). See audit Finding 5.
 *
 * LoopBack validates request bodies with AJV in JSON-Schema draft-07 mode,
 * where `exclusiveMinimum` is a NUMBER. The OpenAPI 3.0 `SchemaObject` type
 * models it as a boolean (paired with `minimum`), and that boolean form is
 * rejected at runtime as an invalid schema (HTTP 500). We therefore emit the
 * number form and cast past the 3.0-shaped type.
 */
export const POSITIVE_WEIGHT_SCHEMA: SchemaObject = {
  type: 'number',
  exclusiveMinimum: 0,
} as unknown as SchemaObject

/**
 * Request-body schemas for the composite `with-details` and single-detail
 * endpoints, parametrized by the per-kind property names. Shared by the purchase
 * and expense controllers so the wire contract (and the positive-weight rule)
 * has ONE source per shape instead of four hand-copied inline blobs that have
 * already drifted once (audit mirror-controllers finding).
 */
export function withDetailsCreateSchema(detailsKey: string): SchemaObject {
  return {
    type: 'object',
    required: ['date'],
    properties: {
      date: { type: 'string', format: 'date' },
      [detailsKey]: {
        type: 'array',
        items: {
          type: 'object',
          required: ['weight_kg', 'productId', 'personId'],
          properties: {
            id: { type: 'number' },
            weight_kg: POSITIVE_WEIGHT_SCHEMA,
            productId: { type: 'number' },
            personId: { type: 'number' },
          },
        },
      },
    },
  }
}

export function withDetailsUpdateSchema(detailsKey: string): SchemaObject {
  return {
    type: 'object',
    // `version` is intentionally NOT schema-required: the service's
    // requireVersion() owns the optimistic-lock-token check so a missing token
    // yields a consistent 400 across PUT, DELETE and single-detail endpoints
    // (rather than a 422 only here). `id` stays required as it is structural.
    required: ['id'],
    properties: {
      id: { type: 'number' },
      version: { type: 'number' },
      date: { type: 'string', format: 'date' },
      [detailsKey]: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            weight_kg: POSITIVE_WEIGHT_SCHEMA,
            productId: { type: 'number' },
            personId: { type: 'number' },
          },
        },
      },
    },
  }
}

/** Full-representation body for a single-detail PUT replace. */
export function singleDetailReplaceSchema(parentFkKey: string): SchemaObject {
  return {
    type: 'object',
    required: ['weight_kg', 'productId', 'personId'],
    properties: {
      weight_kg: POSITIVE_WEIGHT_SCHEMA,
      productId: { type: 'number' },
      personId: { type: 'number' },
      [parentFkKey]: { type: 'number' },
    },
  }
}
