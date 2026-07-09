import { versionRequiredError } from '../../errors'

/**
 * Validates the optimistic-lock token (version / parentVersion) that every
 * transaction mutation must carry. Centralized so create, update, delete and
 * single-detail flows enforce identical rules. Throws an HTTP-agnostic
 * ValidationError; the ErrorHandlerInterceptor maps it to 400.
 */
export function requireVersion(
  value: number | undefined,
  paramName: 'version' | 'parentVersion',
): number {
  if (value == null || !Number.isFinite(value) || value < 1) {
    throw versionRequiredError(paramName)
  }
  return value
}
