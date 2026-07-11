import { expect } from '@loopback/testlab'
import { GeminiQuotaTracker } from '../../modules/form-extraction/gemini/gemini-quota-tracker'

// The tracker is the local stand-in for Gemini's free-tier quota. Its job is to
// skip calls that would be rejected anyway — so what matters is that it counts
// the SAME things Gemini counts. Every case below is a way it used to drift.
describe('GeminiQuotaTracker', () => {
  const MODEL = 'gemini-3.5-flash' // rpm 5, rpd 20, tpm 250000
  const START = 1_000_000

  it('rejects a request once the model has spent its RPM budget', () => {
    const tracker = new GeminiQuotaTracker()

    for (let i = 0; i < 5; i++) {
      expect(tracker.reserve(MODEL, 1000, START).ok).to.be.true()
    }

    const sixth = tracker.reserve(MODEL, 1000, START)
    expect(sixth.ok).to.be.false()
    if (!sixth.ok) expect(sixth.reason).to.match(/RPM/)
  })

  it('frees the budget again once the minute window rolls over', () => {
    const tracker = new GeminiQuotaTracker()
    for (let i = 0; i < 5; i++) tracker.reserve(MODEL, 1000, START)

    const nextMinute = tracker.reserve(MODEL, 1000, START + 60_000)

    expect(nextMinute.ok).to.be.true()
  })

  it('refunds a reservation whose call never reached Gemini', () => {
    const tracker = new GeminiQuotaTracker()
    for (let i = 0; i < 5; i++) tracker.reserve(MODEL, 1000, START)
    expect(tracker.reserve(MODEL, 1000, START).ok).to.be.false()

    tracker.release(MODEL, 1000, START)

    // The refunded slot is usable again inside the same minute: without this a
    // run of pre-flight failures would burn the day's 20 requests for nothing.
    expect(tracker.reserve(MODEL, 1000, START).ok).to.be.true()
  })

  it('never lets a double refund push the counters below zero', () => {
    const tracker = new GeminiQuotaTracker()
    tracker.reserve(MODEL, 1000, START)

    tracker.release(MODEL, 1000, START)
    tracker.release(MODEL, 1000, START)

    // A negative counter would silently hand out extra requests forever.
    for (let i = 0; i < 5; i++) {
      expect(tracker.reserve(MODEL, 1000, START).ok).to.be.true()
    }
    expect(tracker.reserve(MODEL, 1000, START).ok).to.be.false()
  })

  // settle() is what keeps the token window honest: the reservation is a coarse
  // guess, and the audit's rule is that estimates never masquerade as billed
  // usage (Finding H3).
  describe('settle', () => {
    it('replaces the estimate with what the provider actually billed', () => {
      const tracker = new GeminiQuotaTracker()
      // One call estimated at 2 620 tokens really cost 249 000: the next call
      // must be refused, because the true TPM budget is now spent.
      tracker.reserve(MODEL, 2_620, START)

      tracker.settle(MODEL, 2_620, 249_000, START)

      const next = tracker.reserve(MODEL, 2_620, START)
      expect(next.ok).to.be.false()
      if (!next.ok) expect(next.reason).to.match(/TPM/)
    })

    it('gives budget back when the call cost less than estimated', () => {
      const tracker = new GeminiQuotaTracker()
      tracker.reserve(MODEL, 200_000, START)

      tracker.settle(MODEL, 200_000, 1_500, START)

      // An over-estimate must not lock out the rest of the minute.
      expect(tracker.reserve(MODEL, 200_000, START).ok).to.be.true()
    })

    it('keeps the estimate when the model reports no usage', () => {
      const tracker = new GeminiQuotaTracker()
      tracker.reserve(MODEL, 249_000, START)

      tracker.settle(MODEL, 249_000, null, START)

      // A guess beats treating an unreported cost as free.
      const next = tracker.reserve(MODEL, 2_000, START)
      expect(next.ok).to.be.false()
      if (!next.ok) expect(next.reason).to.match(/TPM/)
    })

    it('does not touch the request counters — one call is one call', () => {
      const tracker = new GeminiQuotaTracker()
      for (let i = 0; i < 5; i++) tracker.reserve(MODEL, 1000, START)

      tracker.settle(MODEL, 1000, 10, START)

      expect(tracker.reserve(MODEL, 1000, START).ok).to.be.false()
    })
  })
})
