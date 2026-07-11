// Safe conversion of values crossing the DB/JSON boundary. These live in
// `domain/` so both the repositories that read raw rows and the services that
// aggregate them can depend on the SAME coercion — a repository must never
// import from a service, and duplicating "how do we read a possibly-unparsed
// number" is how the two layers end up disagreeing.

/**
 * Coerces a value from the DB driver or a JSON payload into a usable number.
 * Anything non-numeric collapses to 0 rather than poisoning a running sum with
 * NaN — one bad row must degrade to 0, not blank out the whole report.
 */
export function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Renders a DB date value as a plain ISO calendar day, or null if absent. */
export function toIsoDate(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}
