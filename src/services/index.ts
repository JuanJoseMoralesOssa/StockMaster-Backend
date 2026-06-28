// Barrel rule: re-export every module that an EXTERNAL consumer (a controller,
// the application bootstrap, or a test) imports — injectable services, the
// transaction enum/config, and the pure utils that controllers call directly.
// Pure helpers imported only by sibling services (e.g. transaction-diff.utils,
// transaction-details-sql.helper, the gemini-* transport internals) are
// deep-imported within this folder and intentionally NOT surfaced here.
export * from './form-extraction.service'
export * from './security.service'
export * from './balance-reconciliation.service'
export * from './analytics.service'
export * from './transaction-query.service'
export * from './transaction-kind.enum'
export * from './transaction-type.const'
export * from './purchase-transaction.service'
export * from './payment-transaction.service'
export * from './product.service'
export * from './transaction-with-details.service'
export * from './detail-mutation.service'
export * from './detail-reconciliation.service'
export * from './weight.utils'
export * from './optimistic-lock.utils'
export * from './transaction-execution.utils'
// Pure utils that controllers consume directly (date filters, form field spec).
export * from './date-validation.utils'
export * from './form-spec'
