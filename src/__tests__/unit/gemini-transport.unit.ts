import { expect } from '@loopback/testlab'
import {
  ClientAbortedError,
  consumedRemoteQuota,
  GeminiCallError,
  readGeminiUsage,
  RetryableGeminiError,
  sanitizeRawExtraction,
} from '../../modules/form-extraction/gemini/gemini-transport'

// Post-parse hardening (plan de validación §9, casos B14/B17): a degraded
// model can slip mistyped values past the responseSchema; the sanitizer must
// coerce what is salvageable and null the rest.
describe('sanitizeRawExtraction', () => {
  it('passes through a well-typed payload unchanged', () => {
    const raw = sanitizeRawExtraction({
      fecha: '14/12/2025',
      librasTotal: 140,
      pieles: 20,
      sebo: 50,
      hueso: 70,
      recibiDelSr: 'Juan Jose',
      fieldConfidences: {
        fecha: 0.95,
        librasTotal: 0.9,
        pieles: 0.92,
        sebo: 0.88,
        hueso: 0.87,
        recibiDelSr: 0.9,
      },
    })

    expect(raw.fecha).to.equal('14/12/2025')
    expect(raw.librasTotal).to.equal(140)
    expect(raw.pieles).to.equal(20)
    expect(raw.recibiDelSr).to.equal('Juan Jose')
    expect(raw.fieldConfidences.pieles).to.equal(0.92)
  })

  it('coerces numeric strings (including decimal comma) in number fields', () => {
    const raw = sanitizeRawExtraction({
      fecha: null,
      librasTotal: '140',
      pieles: '50,5',
      sebo: ' 20 ',
      hueso: null,
      recibiDelSr: null,
      fieldConfidences: {},
    })

    expect(raw.librasTotal).to.equal(140)
    expect(raw.pieles).to.equal(50.5)
    expect(raw.sebo).to.equal(20)
    expect(raw.hueso).to.be.null()
  })

  it('nulls mistyped fields instead of letting them through', () => {
    const raw = sanitizeRawExtraction({
      fecha: 14122025, // number where a string belongs
      librasTotal: 'garabato',
      pieles: { valor: 20 },
      sebo: [50],
      hueso: NaN,
      recibiDelSr: 42,
      fieldConfidences: {
        fecha: 0.9,
        librasTotal: 0.9,
        pieles: 0.9,
        sebo: 0.9,
        hueso: 0.9,
        recibiDelSr: 0.9,
      },
    })

    expect(raw.fecha).to.be.null()
    expect(raw.librasTotal).to.be.null()
    expect(raw.pieles).to.be.null()
    expect(raw.sebo).to.be.null()
    expect(raw.hueso).to.be.null()
    expect(raw.recibiDelSr).to.be.null()
  })

  it('clamps out-of-range confidences and drops non-numeric ones', () => {
    const raw = sanitizeRawExtraction({
      fecha: '14/12/2025',
      librasTotal: null,
      pieles: 20,
      sebo: null,
      hueso: null,
      recibiDelSr: 'Juan',
      fieldConfidences: {
        fecha: 5, // clamped to 1
        pieles: -0.3, // clamped to 0
        recibiDelSr: 'alta', // dropped -> normalizer defaults to 0.5
      },
    })

    expect(raw.fieldConfidences.fecha).to.equal(1)
    expect(raw.fieldConfidences.pieles).to.equal(0)
    expect(raw.fieldConfidences.recibiDelSr).to.be.undefined()
  })

  it('tolerates a missing fieldConfidences object entirely', () => {
    const raw = sanitizeRawExtraction({
      fecha: '14/12/2025',
      librasTotal: 100,
      pieles: 100,
      sebo: null,
      hueso: null,
      recibiDelSr: 'Juan',
    })

    expect(raw.pieles).to.equal(100)
    expect(raw.fieldConfidences).to.deepEqual({})
  })

  it('rejects payloads that are not a JSON object', () => {
    expect(() => sanitizeRawExtraction(null)).to.throw(
      /invalid extraction JSON/,
    )
    expect(() => sanitizeRawExtraction([1, 2])).to.throw(
      /invalid extraction JSON/,
    )
    expect(() => sanitizeRawExtraction('texto')).to.throw(
      /invalid extraction JSON/,
    )
  })
})

// The provider's official token accounting (audit Finding H3). Every other
// token number in this codebase is a local estimate; only this one is billable
// truth, so it must survive the parse — and must not invent a zero when absent.
describe('readGeminiUsage', () => {
  it("reads the provider's official token counts", () => {
    const usage = readGeminiUsage({
      usageMetadata: {
        promptTokenCount: 1284,
        candidatesTokenCount: 96,
        thoughtsTokenCount: 320,
        totalTokenCount: 1700,
      },
    })

    expect(usage).to.deepEqual({
      promptTokens: 1284,
      outputTokens: 96,
      thoughtsTokens: 320,
      totalTokens: 1700,
    })
  })

  it('reports null (not zero) when a model omits or garbles the usage block', () => {
    expect(readGeminiUsage({})).to.deepEqual({
      promptTokens: null,
      outputTokens: null,
      thoughtsTokens: null,
      totalTokens: null,
    })

    const garbled = readGeminiUsage({
      usageMetadata: {
        promptTokenCount: -1,
        candidatesTokenCount: undefined,
        totalTokenCount: Number.NaN,
      },
    })
    expect(garbled.promptTokens).to.be.null()
    expect(garbled.outputTokens).to.be.null()
    expect(garbled.totalTokens).to.be.null()
  })
})

// Refunding local quota for a call Gemini already counted makes the guard
// over-permit and pushes the 429s onto the remote API (audit Finding H6).
describe('consumedRemoteQuota', () => {
  it('is true for failures whose request reached Gemini', () => {
    expect(
      consumedRemoteQuota(
        new RetryableGeminiError('timed out', 'timeout', true),
      ),
    ).to.be.true()
    expect(
      consumedRemoteQuota(new GeminiCallError('bad answer', true)),
    ).to.be.true()
    expect(
      consumedRemoteQuota(new ClientAbortedError('gemini-3.5-flash')),
    ).to.be.true()
  })

  it('is false for failures that never left the process', () => {
    // Local quota guard / total-deadline rejections: nothing was sent.
    expect(
      consumedRemoteQuota(new RetryableGeminiError('local RPM')),
    ).to.be.false()
    expect(
      consumedRemoteQuota(new GeminiCallError('GEMINI_API_KEY missing', false)),
    ).to.be.false()
    expect(consumedRemoteQuota(new Error('something else'))).to.be.false()
  })
})
