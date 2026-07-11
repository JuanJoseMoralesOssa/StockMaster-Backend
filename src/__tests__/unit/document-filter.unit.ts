import { expect } from '@loopback/testlab'
import { findFilteredDocuments } from '../../repositories/document-filter.utils'
import { paginationConfig } from '../../config/pagination'

type Document = { id?: number; date?: string }

/**
 * In-memory stand-in for a `*WithTotal` repository. It records the filter it was
 * handed, because THAT is the observable output of `findFilteredDocuments`: the
 * function is a query builder, and the query it builds is what the endpoint's
 * behaviour depends on (a missing date bound silently widens the result set; a
 * missing include scope leaks unrelated detail lines into the response).
 */
class FakeDocumentRepository {
  findCalls = 0
  lastFindFilter?: Record<string, unknown>
  lastCountWhere?: Record<string, unknown>

  constructor(private readonly rows: Document[] = [{ id: 1 }]) {}

  async find(filter?: object): Promise<Document[]> {
    this.findCalls += 1
    this.lastFindFilter = filter as Record<string, unknown>
    return this.rows
  }

  async count(where?: object): Promise<{ count: number }> {
    this.lastCountWhere = where as Record<string, unknown>
    return { count: this.rows.length }
  }
}

/** Never consulted: used by the cases that pass no person/product filter. */
const unusedIdResolver = async (): Promise<number[] | undefined> => {
  throw new Error(
    'getMatchingParentIds must not be called without a detail filter',
  )
}

describe('findFilteredDocuments', () => {
  describe('date bounds', () => {
    it('uses `between` when both endpoints are given', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })

      expect(repo.lastFindFilter?.where).to.eql({
        date: { between: ['2026-01-01', '2026-01-31'] },
      })
    })

    it('uses `gte` when only the start is given', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        startDate: '2026-01-01',
      })

      expect(repo.lastFindFilter?.where).to.eql({
        date: { gte: '2026-01-01' },
      })
    })

    it('uses `lte` when only the end is given', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        endDate: '2026-01-31',
      })

      expect(repo.lastFindFilter?.where).to.eql({
        date: { lte: '2026-01-31' },
      })
    })

    it('applies no date constraint when neither endpoint is given', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(
        repo,
        'purchase_details',
        unusedIdResolver,
        {},
      )

      expect(repo.lastFindFilter?.where).to.eql({})
    })
  })

  describe('person/product filtering', () => {
    it('resolves the matching parent ids and constrains the parent query to them', async () => {
      const repo = new FakeDocumentRepository()
      let receivedDetailWhere: Record<string, unknown> | undefined

      await findFilteredDocuments(
        repo,
        'purchase_details',
        async detailWhere => {
          receivedDetailWhere = detailWhere
          return [7, 9]
        },
        { personId: 3, productId: 5 },
      )

      expect(receivedDetailWhere).to.eql({ personId: 3, productId: 5 })
      expect(repo.lastFindFilter?.where).to.eql({ id: { inq: [7, 9] } })
    })

    it('scopes the included details to the same filter, so unrelated lines do not leak', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', async () => [7], {
        personId: 3,
      })

      expect(repo.lastFindFilter?.include).to.eql([
        {
          relation: 'purchase_details',
          scope: { where: { personId: 3 } },
        },
      ])
    })

    it('includes the relation UNSCOPED when no person/product filter is given', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'payment_details', unusedIdResolver, {
        startDate: '2026-01-01',
      })

      expect(repo.lastFindFilter?.include).to.eql([
        { relation: 'payment_details' },
      ])
    })

    it('short-circuits to an empty page when no parent matches, without querying', async () => {
      // Without this, an empty id list would build `where: {}` and return EVERY
      // document — the exact opposite of the requested filter.
      const repo = new FakeDocumentRepository()

      const result = await findFilteredDocuments(
        repo,
        'purchase_details',
        async () => [],
        { personId: 404 },
      )

      expect(result).to.eql({ data: [], count: 0 })
      expect(repo.findCalls).to.equal(0)
    })

    it('applies no id constraint when the resolver declines to narrow (undefined)', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(
        repo,
        'purchase_details',
        async () => undefined,
        { personId: 3 },
      )

      expect(repo.lastFindFilter?.where).to.eql({})
    })
  })

  describe('pagination and ordering', () => {
    it('orders newest-first and applies the normalized skip/limit', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        page: 3,
        limit: 20,
      })

      expect(repo.lastFindFilter?.order).to.eql(['date DESC'])
      expect(repo.lastFindFilter?.skip).to.equal(40)
      expect(repo.lastFindFilter?.limit).to.equal(20)
    })

    it('clamps an oversized limit through the shared pagination rules', async () => {
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        page: 1,
        limit: 100000,
      })

      expect(repo.lastFindFilter?.limit).to.equal(paginationConfig.MAX_LIMIT)
    })

    it('counts against the same where clause it queries with', async () => {
      // A count computed from a different predicate than the page makes
      // totalPages/hasNext lie to the client.
      const repo = new FakeDocumentRepository()

      await findFilteredDocuments(repo, 'purchase_details', unusedIdResolver, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })

      expect(repo.lastCountWhere).to.eql(repo.lastFindFilter?.where)
    })
  })
})
