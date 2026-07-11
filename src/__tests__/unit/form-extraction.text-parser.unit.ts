import { expect } from '@loopback/testlab'
import { sanitizeRawExtraction } from '../../modules/form-extraction/gemini/gemini-transport'
import {
  EMPTY_TEXT_EXTRACTION_MESSAGE,
  parseExtractionText,
} from '../../modules/form-extraction/form-extraction.text-parser'
import {
  PRODUCT_FIELDS,
  PRODUCT_FIELD_LABELS,
} from '../../modules/form-extraction/form-spec'

const INVALID_JSON = 'invalid extraction JSON'

function parse(text: string) {
  return parseExtractionText(text, sanitizeRawExtraction, INVALID_JSON)
}

// The text path is what every non-Gemini provider falls back to (Ollama, OCR
// Space). It used to keep its own private copy of the product list, so a product
// added to form-spec compiled fine and left the parser silently blind to that
// line. These tests are driven BY the spec: a fourth product with no parser
// entry fails here instead of in production (audit Finding H3).
describe('parseExtractionText', () => {
  it('reads every product line in the shared spec from key-value text', () => {
    const lines = PRODUCT_FIELDS.map(
      (field, index) => `${PRODUCT_FIELD_LABELS[field]}: ${10 + index}`,
    ).join('\n')

    const raw = parse(`Fecha: 14/12/2025\n${lines}\nRecibiDelSr: Juan`)

    PRODUCT_FIELDS.forEach((field, index) => {
      expect(raw[field]).to.equal(10 + index)
      expect(raw.fieldConfidences[field]).to.be.greaterThan(0)
    })
    expect(raw.fecha).to.equal('14/12/2025')
    expect(raw.recibiDelSr).to.equal('Juan')
  })

  it('reads every product line in the shared spec from loose OCR text', () => {
    // No colons, no line structure: raw OCR of the printed form.
    const text = PRODUCT_FIELDS.map(
      (field, index) => `${PRODUCT_FIELD_LABELS[field]} ${20 + index}`,
    ).join('  ')

    const raw = parse(text)

    PRODUCT_FIELDS.forEach((field, index) => {
      expect(raw[field]).to.equal(20 + index)
    })
  })

  it('keeps reading the accent/spelling variants printed on the form', () => {
    const raw = parse('Libra de Cebo: 50,5\nRecibí del Sr.: Ana\nHueso: 70')

    expect(raw.sebo).to.equal(50.5) // decimal comma, Colombian format
    expect(raw.hueso).to.equal(70)
    expect(raw.recibiDelSr).to.equal('Ana')
  })

  it('nulls blank and illegible values instead of guessing', () => {
    const raw = parse('Fecha: null\nPieles: ilegible\nSebo: 20\nHueso: -')

    expect(raw.fecha).to.be.null()
    expect(raw.pieles).to.be.null()
    expect(raw.hueso).to.be.null()
    expect(raw.sebo).to.equal(20)
    expect(raw.fieldConfidences.pieles).to.equal(0)
  })

  it('still prefers a JSON answer when the model returns one', () => {
    const raw = parse('```json\n{"pieles": 100, "fieldConfidences": {}}\n```')

    expect(raw.pieles).to.equal(100)
  })

  it('rejects text with no recognizable field', () => {
    expect(() => parse('firma ilegible y nada mas')).to.throw(
      EMPTY_TEXT_EXTRACTION_MESSAGE,
    )
  })
})
