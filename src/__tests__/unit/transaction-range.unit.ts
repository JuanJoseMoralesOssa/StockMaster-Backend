import { expect } from '@loopback/testlab'
import {
  dateBetweenFilter,
  findParentIdsInRange,
  ParentRepoLike,
} from '../../modules/transactions/transaction-range.utils'

describe('dateBetweenFilter()', () => {
  it('produces a between-range filter with the given bounds', () => {
    expect(dateBetweenFilter('2026-01-01', '2026-01-31')).to.eql({
      between: ['2026-01-01', '2026-01-31'],
    })
  })
})

describe('findParentIdsInRange()', () => {
  /** Fake repo that records the filter it was called with. */
  function fakeRepo(rows: Array<{ id?: number }>) {
    let receivedFilter: object | undefined
    const repo: ParentRepoLike = {
      async find(filter?: object) {
        receivedFilter = filter
        return rows
      },
    }
    return { repo, getReceivedFilter: () => receivedFilter }
  }

  it('queries only the id field with the correct date-between filter', async () => {
    const { repo, getReceivedFilter } = fakeRepo([{ id: 1 }, { id: 2 }])

    await findParentIdsInRange(repo, '2026-01-01', '2026-01-31')

    expect(getReceivedFilter()).to.eql({
      where: { date: { between: ['2026-01-01', '2026-01-31'] } },
      fields: ['id'],
    })
  })

  it('returns the ids found within the range', async () => {
    const { repo } = fakeRepo([{ id: 5 }, { id: 7 }])
    const ids = await findParentIdsInRange(repo, '2026-01-01', '2026-01-31')
    expect(ids).to.eql([5, 7])
  })

  it('filters out null/undefined ids from the result', async () => {
    const { repo } = fakeRepo([
      { id: 1 },
      { id: undefined },
      { id: null as unknown as undefined },
      { id: 4 },
    ])
    const ids = await findParentIdsInRange(repo, '2026-01-01', '2026-01-31')
    expect(ids).to.eql([1, 4])
  })

  it('returns an empty array when nothing is found', async () => {
    const { repo } = fakeRepo([])
    const ids = await findParentIdsInRange(repo, '2026-01-01', '2026-01-31')
    expect(ids).to.eql([])
  })
})
