import { expect } from '@loopback/testlab'
import { ConflictError, DomainError, ResourceNotFoundError } from '../../errors'
import { TransactionDetailsSqlHelper } from '../../modules/transactions/transaction-details-sql.helper'
import { TransactionKind } from '../../modules/transactions/transaction-kind.enum'
import { DataSourceWithTransactions } from '../../modules/transactions/transaction.types'

type RecordedCall = { sql: string; params: unknown[] | undefined }

/**
 * Fake DataSourceWithTransactions that records every `execute()` call and
 * replays scripted results in order — one entry per expected round-trip.
 * Extra calls beyond the script fall back to an empty result set.
 */
function fakeDataSource(results: unknown[]): {
  dataSource: DataSourceWithTransactions
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  let callIndex = 0
  const dataSource: DataSourceWithTransactions = {
    async execute(sql: string, params?: unknown[]) {
      calls.push({ sql, params })
      const result = callIndex < results.length ? results[callIndex] : []
      callIndex++
      return result
    },
  }
  return { dataSource, calls }
}

async function captureRejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected promise to reject')
}

describe('TransactionDetailsSqlHelper.lockParentRow()', () => {
  it('throws a not-found domain error when the parent row does not exist', async () => {
    const { dataSource } = fakeDataSource([[]])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    const err = await captureRejection(() => sql.lockParentRow(1, 1))
    expect(err).to.be.instanceOf(ResourceNotFoundError)
    expect((err as ResourceNotFoundError).kind).to.equal('not_found')
  })

  it('throws a conflict domain error when the version does not match', async () => {
    const { dataSource } = fakeDataSource([[{ id: 1, version: 5 }]])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    const err = await captureRejection(() => sql.lockParentRow(1, 3))
    expect(err).to.be.instanceOf(ConflictError)
    expect((err as ConflictError).kind).to.equal('conflict')
  })

  it('does not throw when the version matches, even as a driver-returned string', async () => {
    // Some drivers return numeric columns as strings; the comparison must
    // coerce before comparing, or every request would spuriously 409.
    const { dataSource } = fakeDataSource([[{ id: 1, version: '3' }]])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    await sql.lockParentRow(1, 3)
  })

  it('issues a row lock (FOR UPDATE) — this is the guarantee the caller relies on', async () => {
    const { dataSource, calls } = fakeDataSource([[{ id: 1, version: 1 }]])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    await sql.lockParentRow(1, 1)
    expect(calls[0].sql).to.match(/FOR UPDATE/)
  })
})

describe('TransactionDetailsSqlHelper.updateParentWithVersionCheck()', () => {
  it('throws a plain (non-domain) internal error for a field outside the whitelist', async () => {
    const { dataSource } = fakeDataSource([])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    const err = await captureRejection(() =>
      sql.updateParentWithVersionCheck(1, 1, { notAllowed: 'x' }, 2),
    )
    // Internal wiring bug, not client-facing: must NOT be a DomainError (those
    // map to 4xx), so the interceptor lets it surface as an opaque 500.
    expect(err).to.be.instanceOf(Error)
    expect(err).to.not.be.instanceOf(DomainError)
  })

  it('returns a conflict when no rows are affected but the parent still exists', async () => {
    const { dataSource } = fakeDataSource([
      [], // UPDATE ... RETURNING id -> nothing matched (stale version)
      [{ id: 1 }], // existence probe -> parent is still there
    ])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    const err = await captureRejection(() =>
      sql.updateParentWithVersionCheck(1, 1, { date: '2026-01-01' }, 2),
    )
    expect(err).to.be.instanceOf(ConflictError)
  })

  it('returns not-found when no rows are affected and the parent no longer exists', async () => {
    const { dataSource } = fakeDataSource([
      [], // UPDATE ... RETURNING id -> nothing matched
      [], // existence probe -> parent is gone
    ])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    const err = await captureRejection(() =>
      sql.updateParentWithVersionCheck(1, 1, { date: '2026-01-01' }, 2),
    )
    expect(err).to.be.instanceOf(ResourceNotFoundError)
  })

  it('drops undefined-valued entries before the whitelist check, instead of rejecting them', async () => {
    // If the undefined entry were NOT filtered first, its key ("ghostField")
    // would fail the whitelist check below and this would throw. It doesn't,
    // which is the observable proof that filtering happened.
    const { dataSource } = fakeDataSource([[{ id: 1 }]])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    await sql.updateParentWithVersionCheck(
      1,
      1,
      { date: '2026-01-01', ghostField: undefined },
      2,
    )
  })
})

describe('TransactionDetailsSqlHelper.batchDeleteByIds()', () => {
  it('executes no SQL at all for an empty id list', async () => {
    const { dataSource, calls } = fakeDataSource([])
    const sql = new TransactionDetailsSqlHelper(
      dataSource,
      TransactionKind.PURCHASE,
    )

    await sql.batchDeleteByIds([])
    expect(calls).to.have.length(0)
  })
})
