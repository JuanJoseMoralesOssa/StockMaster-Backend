import { getModelSchemaRef, SchemaObject } from '@loopback/rest'
import { Model } from '@loopback/repository'

/**
 * OpenAPI schema for a `Pagination<T>` response body.
 *
 * Every list endpoint returns the same envelope, but the schema used to be
 * hand-copied per endpoint — and had already drifted: `/purchases` and
 * `/payments` documented `totalPages`/`hasNext`/`hasPrevious` while their
 * `/filtered` twins omitted them, even though `Pagination` always computes and
 * sends all three. Clients reading the spec were told those fields might not
 * exist. One factory means the envelope is described in exactly one place.
 */
export function paginatedSchema(
  model: Function & { prototype: Model },
  options: { includeRelations?: boolean } = { includeRelations: true },
): SchemaObject {
  return {
    type: 'object',
    properties: {
      count: { type: 'number' },
      data: {
        type: 'array',
        items: getModelSchemaRef(model, {
          includeRelations: options.includeRelations,
        }),
      },
      page: { type: 'number' },
      limit: { type: 'number' },
      totalPages: { type: 'number' },
      hasNext: { type: 'boolean' },
      hasPrevious: { type: 'boolean' },
    },
  }
}
