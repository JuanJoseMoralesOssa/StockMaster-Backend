// Barrel rule: re-export every module that an EXTERNAL consumer (a controller,
// the application bootstrap, or a test) imports — injectable services, the
// transaction enum/config, and the pure utils that controllers call directly.
// Pure helpers imported only by sibling services (e.g. transaction-diff.utils,
// transaction-details-sql.helper, the gemini-* transport internals) are
// deep-imported within this folder and intentionally NOT surfaced here.
export * from '../modules/form-extraction'
export * from '../modules/transactions'
export * from './security.service'
export * from './analytics.service'
export * from './product.service'
export * from './user.service'
export * from './kardex-query.service'
// Pure utils that controllers consume directly (date filters).
export * from './date-validation.utils'
