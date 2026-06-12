import { expect } from '@loopback/testlab'
import {
  LB_TO_KG,
  RawExtractionFields,
  matchProduct,
  matchSupplier,
  normalize,
  normalizeForMatch,
  parseDate,
  supplierMatchScore,
} from '../../services/form-extraction.normalizer'

const PEOPLE = [
  { id: 1, name: 'Juan Pérez' },
  { id: 2, name: 'María Gómez' },
  { id: 3, name: 'Carlos Rodríguez' },
]

const PRODUCTS = [
  { id: 10, name: 'Piel' },
  { id: 20, name: 'Sebo' },
  { id: 30, name: 'Hueso' },
]

function rawFields(
  overrides: Partial<RawExtractionFields> = {},
): RawExtractionFields {
  return {
    fecha: '14/12/2025',
    librasTotal: null,
    pieles: null,
    sebo: null,
    hueso: null,
    recibiDelSr: null,
    fieldConfidences: {
      fecha: 0.95,
      librasTotal: 0.9,
      pieles: 0.9,
      sebo: 0.9,
      hueso: 0.9,
      recibiDelSr: 0.9,
    },
    ...overrides,
  }
}

describe('form-extraction normalizer', () => {
  describe('normalizeForMatch', () => {
    it('lowercases, strips accents and punctuation', () => {
      expect(normalizeForMatch('Juan Pérez!')).to.equal('juan perez')
      expect(normalizeForMatch('  María   Gómez ')).to.equal('maria gomez')
    })
  })

  describe('parseDate', () => {
    it('parses DD/MM/YYYY to ISO', () => {
      const r = parseDate('14/12/2025')
      expect(r.value).to.equal('2025-12-14')
      expect(r.needsReview).to.be.false()
    })

    it('parses two-digit year DD-MM-YY', () => {
      expect(parseDate('05-03-26').value).to.equal('2026-03-05')
    })

    it('parses dot separators', () => {
      expect(parseDate('1.2.2025').value).to.equal('2025-02-01')
    })

    it('flags null/blank for review', () => {
      expect(parseDate(null).needsReview).to.be.true()
      expect(parseDate('garabato').needsReview).to.be.true()
    })

    it('rejects out-of-range day/month', () => {
      expect(parseDate('45/13/2025').value).to.be.null()
    })
  })

  describe('supplier matching', () => {
    it('scores exact (accent-insensitive) match as 1', () => {
      expect(supplierMatchScore('juan perez', 'Juan Pérez')).to.equal(1)
    })

    it('matches a confident supplier and assigns personId', () => {
      const m = matchSupplier('Juan Peres', PEOPLE) // typo
      expect(m.personId).to.equal(1)
      expect(m.needsReview).to.be.false()
      expect(m.candidates[0].id).to.equal(1)
    })

    it('flags low-confidence match for review and leaves personId undefined', () => {
      const m = matchSupplier('Zzzz Xyz', PEOPLE)
      expect(m.personId).to.be.undefined()
      expect(m.needsReview).to.be.true()
    })

    it('flags empty name for review', () => {
      const m = matchSupplier('   ', PEOPLE)
      expect(m.needsReview).to.be.true()
      expect(m.candidates).to.be.empty()
    })
  })

  describe('product matching', () => {
    it('maps each field to its catalogue product', () => {
      expect(matchProduct('pieles', PRODUCTS)?.id).to.equal(10)
      expect(matchProduct('sebo', PRODUCTS)?.id).to.equal(20)
      expect(matchProduct('hueso', PRODUCTS)?.id).to.equal(30)
    })

    it('matches the Cebo alias to a Sebo product', () => {
      expect(matchProduct('sebo', [{ id: 99, name: 'Cebo' }])?.id).to.equal(99)
    })

    it('returns undefined when no product matches', () => {
      expect(matchProduct('hueso', [{ id: 1, name: 'Piel' }])).to.be.undefined()
    })
  })

  describe('normalize', () => {
    it('builds one detail per present product and converts lb→kg', () => {
      const raw = rawFields({
        pieles: 100,
        sebo: 10,
        recibiDelSr: 'Juan Pérez',
      })
      const result = normalize(raw, PEOPLE, PRODUCTS)

      expect(result.details).to.have.length(2)
      const piel = result.details.find(d => d.fieldName === 'pieles')!
      expect(piel.productId).to.equal(10)
      expect(piel.weightKg).to.equal(Math.round(100 * LB_TO_KG * 1000) / 1000)
      expect(result.supplier.personId).to.equal(1)
      expect(result.needsReview).to.be.false()
    })

    it('skips blank product fields', () => {
      const raw = rawFields({ hueso: 5, recibiDelSr: 'Juan Pérez' })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.details).to.have.length(1)
      expect(result.details[0].fieldName).to.equal('hueso')
    })

    it('passes the soft total check within tolerance', () => {
      const raw = rawFields({
        pieles: 100,
        librasTotal: 100,
        recibiDelSr: 'Juan Pérez',
      })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.totalWeightCheck.passed).to.be.true()
    })

    it('flags review when the form total disagrees with the sum', () => {
      const raw = rawFields({
        pieles: 100,
        librasTotal: 250,
        recibiDelSr: 'Juan Pérez',
      })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.totalWeightCheck.passed).to.be.false()
      expect(result.needsReview).to.be.true()
    })

    it('does not hard-fail when the total is absent', () => {
      const raw = rawFields({
        pieles: 100,
        librasTotal: null,
        recibiDelSr: 'Juan Pérez',
      })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.totalWeightCheck.passed).to.be.true()
    })

    it('flags a low-confidence field for review', () => {
      const raw = rawFields({
        pieles: 100,
        recibiDelSr: 'Juan Pérez',
        fieldConfidences: {
          fecha: 0.95,
          librasTotal: 0.9,
          pieles: 0.4,
          sebo: 0.9,
          hueso: 0.9,
          recibiDelSr: 0.9,
        },
      })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.details[0].needsReview).to.be.true()
      expect(result.needsReview).to.be.true()
    })

    it('flags review when no products were detected', () => {
      const raw = rawFields({ recibiDelSr: 'Juan Pérez' })
      const result = normalize(raw, PEOPLE, PRODUCTS)
      expect(result.details).to.be.empty()
      expect(result.reviewReasons).to.containEql(
        'No se detectaron valores de productos',
      )
    })
  })
})
