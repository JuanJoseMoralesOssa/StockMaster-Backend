/**
 * Names of hand-managed PostgreSQL constraints. Shared between the migration
 * that creates them (src/migrate.ts) and the error interceptor that
 * string-matches them to produce friendly HTTP errors — keeping both sides on
 * one constant so a rename cannot silently break the mapping.
 */
export const DB_CONSTRAINTS = {
  PRODUCT_STOCK_MIN: 'chk_product_stock_min',
} as const

/** PostgreSQL error codes the application maps to specific HTTP statuses. */
export const PG_ERROR_CODES = {
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const
