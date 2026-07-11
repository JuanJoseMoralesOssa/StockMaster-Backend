// Local, best-effort guard that mirrors Gemini's per-model RPM/TPM/RPD quotas
// so the fallback chain skips a model we have likely already exhausted before
// paying for a round-trip. State is INSTANCE-scoped (not a module global), so
// each provider owns its own counters — that removes the test-only reset hook
// and makes the limits swappable (e.g. a Redis-backed tracker) under
// horizontal scaling, where a per-process Map would over-permit by N×.

export interface GeminiModelLimit {
  rpm: number
  tpm: number
  rpd: number
}

const DEFAULT_GEMINI_MODEL_LIMIT: GeminiModelLimit = {
  rpm: 5,
  tpm: 250000,
  rpd: 20,
}

const GEMINI_MODEL_LIMITS: Record<string, GeminiModelLimit> = {
  'gemini-3.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
}

interface GeminiQuotaWindow {
  minuteStartedAt: number
  minuteRequests: number
  minuteTokens: number
  dayStartedAt: number
  dayRequests: number
}

const ONE_MINUTE_MS = 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type QuotaReservation =
  | { ok: true }
  | { ok: false; reason: string; limit: GeminiModelLimit }

export class GeminiQuotaTracker {
  private readonly windows = new Map<string, GeminiQuotaWindow>()

  /**
   * Attempts to reserve one request (plus its estimated tokens) against the
   * model's local quota window, rolling the minute/day windows as time passes.
   * Returns ok=false with a human-readable reason when a limit is hit.
   */
  reserve(
    model: string,
    estimatedTokens: number,
    now: number = Date.now(),
  ): QuotaReservation {
    const limit = this.limitFor(model)
    const window = this.windowFor(model, now)

    if (window.minuteRequests >= limit.rpm) {
      return {
        ok: false,
        limit,
        reason: `${model} alcanzó su límite local de ${limit.rpm} RPM`,
      }
    }
    if (window.dayRequests >= limit.rpd) {
      return {
        ok: false,
        limit,
        reason: `${model} alcanzó su límite local de ${limit.rpd} RPD`,
      }
    }
    if (window.minuteTokens + estimatedTokens > limit.tpm) {
      return {
        ok: false,
        limit,
        reason: `${model} alcanzó su límite local estimado de ${limit.tpm} TPM`,
      }
    }

    window.minuteRequests += 1
    window.dayRequests += 1
    window.minuteTokens += estimatedTokens
    return { ok: true }
  }

  /**
   * Replaces a token RESERVATION with the provider's official `usageMetadata`
   * count once the call returns. The reservation is a coarse guess (see
   * estimateGeminiRequestTokens); leaving it in place would drift the local TPM
   * window away from what Gemini actually billed, in either direction. Requests
   * (RPM/RPD) are not touched — one call is one call, whatever it cost.
   * A model that reports no usage keeps its estimate: a guess beats a zero.
   */
  settle(
    model: string,
    estimatedTokens: number,
    actualTokens: number | null,
    now: number = Date.now(),
  ): void {
    if (actualTokens === null) return
    const window = this.windowFor(model, now)
    window.minuteTokens = Math.max(
      0,
      window.minuteTokens - estimatedTokens + actualTokens,
    )
  }

  /**
   * Refunds a reservation whose model call never actually reached Gemini — a
   * local quota rejection, a missing API key, a connection that never landed.
   * Without this, a run of such failures permanently burns the durable daily
   * request counter (`rpd`, as low as 20) and the local guard locks the feature
   * out for the rest of the day while the real Gemini quota is untouched.
   *
   * The caller MUST NOT refund a dispatched attempt (see `consumedRemoteQuota`):
   * a request that Gemini received counts against RPM/RPD even if we aborted
   * before reading the answer, and refunding it would make this guard
   * over-permit and push the real 429s onto the remote API (audit Finding H6).
   * Clamped at 0 so a double-release can never push a counter negative.
   */
  release(
    model: string,
    estimatedTokens: number,
    now: number = Date.now(),
  ): void {
    const window = this.windowFor(model, now)
    window.minuteRequests = Math.max(0, window.minuteRequests - 1)
    window.dayRequests = Math.max(0, window.dayRequests - 1)
    window.minuteTokens = Math.max(0, window.minuteTokens - estimatedTokens)
  }

  /** Clears all counters (used by tests for isolation). */
  reset(): void {
    this.windows.clear()
  }

  private limitFor(model: string): GeminiModelLimit {
    return GEMINI_MODEL_LIMITS[model] ?? DEFAULT_GEMINI_MODEL_LIMIT
  }

  private windowFor(model: string, now: number): GeminiQuotaWindow {
    const existing = this.windows.get(model)
    if (!existing) {
      const created: GeminiQuotaWindow = {
        minuteStartedAt: now,
        minuteRequests: 0,
        minuteTokens: 0,
        dayStartedAt: now,
        dayRequests: 0,
      }
      this.windows.set(model, created)
      return created
    }

    if (now - existing.minuteStartedAt >= ONE_MINUTE_MS) {
      existing.minuteStartedAt = now
      existing.minuteRequests = 0
      existing.minuteTokens = 0
    }
    if (now - existing.dayStartedAt >= ONE_DAY_MS) {
      existing.dayStartedAt = now
      existing.dayRequests = 0
    }

    return existing
  }
}
