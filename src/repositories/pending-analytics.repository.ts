import { inject } from '@loopback/core'
import { PostgresDataSource } from '../datasources'
import { toFiniteNumber, toIsoDate } from '../domain/coercion'
import { roundWeight } from '../domain/weight'
import {
  PendingByProduct,
  PendingBySupplier,
  PendingTrendInterval,
  PendingTrendPoint,
} from '../models'

/**
 * Calendar the pending reports are read against. Kardex timestamps are stored in
 * UTC, but the "días pendiente" ageing the UI shows is counted against the
 * operator's local calendar: a movement at 20:00 in Bogotá is 01:00 UTC the NEXT
 * day, so bucketing it by the UTC date would report it as a day older than it
 * is. A server-owned constant, never client input — safe to interpolate.
 */
const REPORTING_TIME_ZONE = 'America/Bogota'

/** The only groupings `getPendingTrend` may bucket by. */
const TREND_BUCKETS: readonly PendingTrendInterval[] = ['day', 'week', 'month']

/**
 * The pending-balance reports, read with hand-written SQL.
 *
 * These three queries do not go through the LoopBack repositories on purpose:
 * they are aggregations (running balances, per-supplier subtraction across two
 * tables, a correlated "since when" lookup over the Kardex) that the query
 * builder cannot express, and doing them in memory would mean loading every
 * detail row of the system on each dashboard call.
 *
 * They live in `repositories/` rather than in AnalyticsService because that is
 * the layer that is allowed to know table and column names. AnalyticsService
 * consumes the typed rows and never sees a SQL string.
 */
export class PendingAnalyticsRepository {
  constructor(
    @inject('datasources.postgres')
    private readonly dataSource: PostgresDataSource,
  ) {}

  /**
   * Pending (compras − pagos) over time as an ABSOLUTE balance: the series
   * starts from the pending accumulated BEFORE startDate, so the line shows the
   * real outstanding balance rather than just the period's variation.
   */
  async findPendingTrend(
    startDate: string,
    endDate: string,
    interval: PendingTrendInterval,
  ): Promise<PendingTrendPoint[]> {
    // Whitelisted before interpolation: `bucket` is the one fragment of these
    // queries that is not a bound parameter, because Postgres does not accept a
    // parameter for date_trunc's field argument.
    const bucket = TREND_BUCKETS.includes(interval) ? interval : 'day'

    const [baselineRow] = await this.query<{ baseline: string | number }>(
      `SELECT
         COALESCE((SELECT SUM(pd.weight_kg) FROM purchasedetails pd
                   JOIN purchase p ON pd.purchaseid = p.id
                   WHERE p.date::date < $1::date), 0)
       - COALESCE((SELECT SUM(qd.weight_kg) FROM paymentdetails qd
                   JOIN payment q ON qd.paymentid = q.id
                   WHERE q.date::date < $1::date), 0) AS baseline`,
      [startDate],
    )

    const [purchases, payments] = await Promise.all([
      this.query<{ bucket: unknown; w: string | number }>(
        `SELECT date_trunc('${bucket}', p.date)::date AS bucket, SUM(pd.weight_kg) AS w
           FROM purchasedetails pd JOIN purchase p ON pd.purchaseid = p.id
          WHERE p.date::date BETWEEN $1::date AND $2::date
          GROUP BY 1`,
        [startDate, endDate],
      ),
      this.query<{ bucket: unknown; w: string | number }>(
        `SELECT date_trunc('${bucket}', q.date)::date AS bucket, SUM(qd.weight_kg) AS w
           FROM paymentdetails qd JOIN payment q ON qd.paymentid = q.id
          WHERE q.date::date BETWEEN $1::date AND $2::date
          GROUP BY 1`,
        [startDate, endDate],
      ),
    ])

    return buildPendingTrend(
      toFiniteNumber(baselineRow?.baseline),
      indexByBucket(purchases),
      indexByBucket(payments),
    )
  }

  /** Pending (bought − paid) per supplier, all-time, only those still owed (> 0). */
  async findPendingBySupplier(limit: number): Promise<PendingBySupplier[]> {
    const rows = await this.query<{
      personId: number
      personName: string
      purchased: string | number
      paid: string | number
      pending: string | number
    }>(
      `SELECT person.id AS "personId", person.name AS "personName",
              COALESCE(pur.w, 0) AS purchased,
              COALESCE(pay.w, 0) AS paid,
              COALESCE(pur.w, 0) - COALESCE(pay.w, 0) AS pending
         FROM person
         LEFT JOIN (SELECT personid, SUM(weight_kg) w FROM purchasedetails GROUP BY personid) pur
                ON pur.personid = person.id
         LEFT JOIN (SELECT personid, SUM(weight_kg) w FROM paymentdetails GROUP BY personid) pay
                ON pay.personid = person.id
        WHERE COALESCE(pur.w, 0) - COALESCE(pay.w, 0) > 0
        ORDER BY pending DESC
        LIMIT $1`,
      [limit],
    )

    return rows.map(row => ({
      personId: Number(row.personId),
      personName: row.personName,
      purchased: roundWeight(toFiniteNumber(row.purchased)),
      paid: roundWeight(toFiniteNumber(row.paid)),
      pending: roundWeight(toFiniteNumber(row.pending)),
    }))
  }

  /** Products still owed (balance > 0), with how long they have been outstanding. */
  async findPendingByProduct(limit: number): Promise<PendingByProduct[]> {
    const rows = await this.query<{
      productId: number
      productName: string
      balance: string | number
      pendingSince: string | Date | null
    }>(
      // pendingSince = start of the CURRENT pending streak: the first movement
      // after the last time the balance settled back to <= 0 (`<= 0` tolerates
      // rounding residue). Falls back to the product's first movement when it
      // never returned to zero. See REPORTING_TIME_ZONE for the date conversion.
      `SELECT pr.id AS "productId", pr.name AS "productName", pr.balance AS balance,
              COALESCE(
                (SELECT MIN((k.date AT TIME ZONE '${REPORTING_TIME_ZONE}')::date)
                   FROM kardex k
                  WHERE k.productid = pr.id
                    AND k.date > COALESCE(
                          (SELECT MAX(k2.date) FROM kardex k2
                            WHERE k2.productid = pr.id AND k2.balance <= 0),
                          '-infinity'::timestamptz)),
                (SELECT MIN((k.date AT TIME ZONE '${REPORTING_TIME_ZONE}')::date)
                   FROM kardex k WHERE k.productid = pr.id)
              ) AS "pendingSince"
         FROM product pr
        WHERE pr.balance > 0
        ORDER BY pr.balance DESC
        LIMIT $1`,
      [limit],
    )

    return rows.map(row => ({
      productId: Number(row.productId),
      productName: row.productName,
      balance: roundWeight(toFiniteNumber(row.balance)),
      pendingSince: toIsoDate(row.pendingSince),
    }))
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const result = await this.dataSource.execute(sql, params)
    if (Array.isArray(result)) return result as T[]
    const rows = (result as { rows?: unknown }).rows
    return (Array.isArray(rows) ? rows : []) as T[]
  }
}

type BucketRow = { bucket: unknown; w: string | number }

function indexByBucket(rows: BucketRow[]): Map<string, number> {
  const byBucket = new Map<string, number>()
  for (const row of rows) {
    const period = toIsoDate(row.bucket)
    if (period) byBucket.set(period, toFiniteNumber(row.w))
  }
  return byBucket
}

/**
 * Walks the buckets in chronological order, carrying the pre-range baseline
 * forward, so each point reports the ABSOLUTE pending at the end of its bucket
 * rather than the bucket's own delta. Pure — the running-balance arithmetic is
 * the one decision in this file that is worth testing without a database.
 */
export function buildPendingTrend(
  baseline: number,
  purchasedByBucket: Map<string, number>,
  paidByBucket: Map<string, number>,
): PendingTrendPoint[] {
  const periods = Array.from(
    new Set([...purchasedByBucket.keys(), ...paidByBucket.keys()]),
  ).sort()

  let running = baseline
  return periods.map(period => {
    const purchased = roundWeight(purchasedByBucket.get(period) ?? 0)
    const paid = roundWeight(paidByBucket.get(period) ?? 0)
    running += purchased - paid
    return { period, purchased, paid, pending: roundWeight(running) }
  })
}
