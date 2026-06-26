import { USER_MESSAGES, ValidationError } from '../errors'
import { DetailBase } from './transaction.types'

/**
 * Single source of truth for "is this detail row well-formed" — product +
 * person present, weight strictly positive. Previously copy-pasted in
 * TransactionWithDetailsService and DetailMutationService; sharing it keeps the
 * two write paths from drifting. Throws HTTP-agnostic ValidationError (→ 400).
 */
export function assertDetailValid(detail: Partial<DetailBase>): void {
  if (detail.productId == null || detail.personId == null) {
    throw new ValidationError(USER_MESSAGES.DETAIL_FIELDS_REQUIRED)
  }
  if (detail.weight_kg == null || detail.weight_kg <= 0) {
    throw new ValidationError(USER_MESSAGES.WEIGHT_POSITIVE)
  }
}

export function assertDetailsValid(details: Array<Partial<DetailBase>>): void {
  for (const detail of details) {
    assertDetailValid(detail)
  }
}
