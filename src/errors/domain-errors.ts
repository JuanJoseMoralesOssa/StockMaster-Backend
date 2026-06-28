import {
  foreignDetailMessage,
  notFoundMessage,
  productBalanceNotFoundMessage,
  USER_MESSAGES,
  versionRequiredMessage,
} from './user-messages'

/**
 * Semantic class of a domain failure. The ErrorHandlerInterceptor is the single
 * place that turns each kind into an HTTP status, so the services, helpers and
 * pure utilities below stay free of any `@loopback/rest` dependency (see
 * Finding 1 of the maintainability audit). Keeping the mapping in one place
 * means the decision "version mismatch == 409" is made once, not three layers
 * deep in a raw-SQL helper.
 */
export type DomainErrorKind =
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'timeout'
  | 'rate_limited'
  | 'unprocessable'

/** Base class for every HTTP-agnostic domain failure. */
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Invalid client input. Maps to 400. */
export class ValidationError extends DomainError {
  readonly kind = 'validation' as const
}

/** A required resource (transaction, product, …) does not exist. Maps to 404. */
export class ResourceNotFoundError extends DomainError {
  readonly kind = 'not_found' as const
}

/** Optimistic-lock / state conflict. Maps to 409. */
export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const
}

/** Upstream/dependency took too long. Maps to 408. */
export class TimeoutError extends DomainError {
  readonly kind = 'timeout' as const
}

/** Upstream/dependency is rate-limited or exhausted. Maps to 429. */
export class RateLimitedError extends DomainError {
  readonly kind = 'rate_limited' as const
}

/**
 * Request was well-formed but cannot be processed (e.g. a dependency returned
 * an unusable result, or is misconfigured). Maps to 422.
 */
export class UnprocessableError extends DomainError {
  readonly kind = 'unprocessable' as const
}

/**
 * An incoming detail id does not belong to the transaction being reconciled.
 * Pure utilities (transaction-diff.utils) throw this; the interceptor maps it
 * to 403 — no service-level translation needed.
 */
export class ForeignDetailError extends DomainError {
  readonly kind = 'forbidden' as const

  constructor(public readonly detailId: number) {
    super(foreignDetailMessage(detailId))
  }
}

// --- Convenience factories so call sites read intent-first and stay terse. ---

export function versionRequiredError(
  paramName: 'version' | 'parentVersion',
): ValidationError {
  return new ValidationError(versionRequiredMessage(paramName))
}

export function versionConflictError(): ConflictError {
  return new ConflictError(USER_MESSAGES.CONFLICT_MODIFIED)
}

export function transactionNotFoundError(
  entity: string,
  id: number,
): ResourceNotFoundError {
  return new ResourceNotFoundError(notFoundMessage(entity, id))
}

export function productBalanceNotFoundError(
  productId: number,
): ResourceNotFoundError {
  return new ResourceNotFoundError(productBalanceNotFoundMessage(productId))
}
