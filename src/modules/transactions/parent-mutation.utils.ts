import {
  UPDATABLE_PARENT_FIELDS,
  UpdatableParentField,
} from './transaction-type.const'

/**
 * Structural shape accepted by `buildParentUpdatePayload`. Deliberately loose
 * (not the service's `UpdateTransactionWithDetailsInput`) so this module has
 * no dependency on the service — any caller-side DTO with these fields works.
 */
export type ParentUpdateInput = {
  id?: number
  version?: number
  date?: string
  details?: unknown[]
}

/**
 * Strips the request-envelope fields (`details`, `id`, `version`) and any
 * `undefined` values, leaving only the columns that are candidates for the
 * parent-document UPDATE. Pure: same input always yields the same output.
 */
export function buildParentUpdatePayload<TParent>(
  input: ParentUpdateInput,
): Partial<TParent> {
  const payload = { ...input } as Record<string, unknown>
  delete payload.details
  delete payload.id
  delete payload.version

  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) {
      delete payload[key]
    }
  }

  return payload as Partial<TParent>
}

/**
 * Decides whether the parent document actually changed, so an idempotent
 * re-PUT does not burn an optimistic-lock version. Driven by
 * UPDATABLE_PARENT_FIELDS — the SAME whitelist the SQL writer enforces — so
 * the no-op detector and the writer cannot disagree about which columns
 * matter (a disagreement would silently skip the version bump and reopen the
 * lost-update window the version field exists to close).
 */
export function hasParentMutations<TParent extends object>(
  payload: Partial<TParent>,
  currentParent: TParent,
): boolean {
  const current = currentParent as Record<string, unknown>
  const incoming = payload as Record<string, unknown>
  return UPDATABLE_PARENT_FIELDS.some(field => {
    if (!(field in incoming)) return false
    return (
      normalizeComparableValue(field, current[field]) !==
      normalizeComparableValue(field, incoming[field])
    )
  })
}

/**
 * Per-field normalization for the no-op comparison. `date` is persisted at
 * day precision, so compare day-only whether the value arrives as a Date or
 * an ISO string; other (future) fields compare by raw value.
 */
export function normalizeComparableValue(
  field: UpdatableParentField,
  value: unknown,
): unknown {
  if (field === 'date') {
    return toDateOnly(value)
  }
  return value
}

export function toDateOnly(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    const datePrefix = /^\d{4}-\d{2}-\d{2}/.exec(value)
    return datePrefix ? datePrefix[0] : value
  }
  return value
}
