import { foreignDetailMessage } from './user-messages'

/**
 * Domain error: an incoming detail id does not belong to the transaction
 * being reconciled. Pure utilities (transaction-diff.utils) throw this instead
 * of an HttpError so they stay HTTP-agnostic; the service layer translates it
 * to a 403 (see DetailReconciliationService.computeDiff).
 */
export class ForeignDetailError extends Error {
  constructor(public readonly detailId: number) {
    super(foreignDetailMessage(detailId))
    this.name = 'ForeignDetailError'
  }
}
