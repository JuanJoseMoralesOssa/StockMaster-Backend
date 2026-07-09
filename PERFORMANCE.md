# Performance: move reporting aggregation into SQL

**Status:** deferred (deliberately). Identified in the June 2026 code review as a
Medium finding; all correctness/security findings from that review are done.
This is the one remaining item, kept as documented future work because it is a
scaling concern, not a correctness bug — the current implementations return
correct results.

## Problem

The reporting services load detail rows (plus included relations) into Node
memory and aggregate them in TypeScript. Cost grows linearly with transaction
volume per requested date range, on every dashboard request:

| Hot spot | What it does today |
| --- | --- |
| `AnalyticsService.getSupplierAnalytics` (`src/services/analytics.service.ts`) | Fetches all purchase/expense IDs in range, then **all matching detail rows with `purchase`/`expense` + `person` relations included**, and sums weight/count per supplier in a `Map`. |
| `AnalyticsService.getProductAnalytics` | Same pattern with `product` relations — a second full fetch of the same detail rows. |
| `AnalyticsService.getWeightTotalsByType` | A **third** fetch of the same detail rows (only `weight_kg`) to total purchases vs. expenses. |
| `AnalyticsService.getInventorySummary` | Loads every product row to compute totals/low-stock in JS (smaller risk; product count grows slowly). |
| `TransactionQueryService.getPersonProductTransactions` / `getProductTransactions` / `getPersonTransactions` (`src/modules/transactions/transaction-query.service.ts`) | Load a person/product with deeply included purchases+expenses+details and flatten/aggregate in JS. |

Net effect for one `GET /analytics/dashboard-summary` call: the same detail
rows are pulled from PostgreSQL **three times**, hydrated into LoopBack
entities with relations, then reduced in JS. The two-step `find IDs → find
details with inq` pattern also produces large `IN (...)` lists instead of a
join.

## When to act

Don't optimize speculatively. Trigger this work when any of these is true:

- Dashboard endpoints (`/analytics/…`) exceed ~500 ms p95 with a warm DB.
- `purchasedetails + expensedetails` rows in a typical queried range exceed
  ~50k (memory and GC pressure become visible).
- Node memory spikes correlate with report requests.

## Recommended approach

Replace the fetch-then-reduce pipelines with `GROUP BY` queries executed via
`dataSource.execute(sql, params)` — the same mechanism
`StockReconciliationService` and `TransactionDetailsSqlHelper` already use.
Tables are lowercase (`purchase`, `expense`, `purchasedetails`,
`expensedetails`, `person`, `product`; columns `purchaseid`, `expenseid`,
`personid`, `productid`, `weight_kg`).

Supplier aggregation (both kinds, one round-trip) — sketch:

```sql
SELECT d.personid                AS "personId",
       p.name                    AS "personName",
       SUM(d.weight_kg)::float   AS "totalWeight",
       COUNT(*)::int             AS "transactionCount"
FROM (
  SELECT pd.personid, pd.weight_kg
  FROM purchasedetails pd
  JOIN purchase t ON t.id = pd.purchaseid
  WHERE t.date BETWEEN $1 AND $2 AND pd.weight_kg > 0
  UNION ALL
  SELECT ed.personid, ed.weight_kg
  FROM expensedetails ed
  JOIN expense t ON t.id = ed.expenseid
  WHERE t.date BETWEEN $1 AND $2 AND ed.weight_kg > 0
) d
JOIN person p ON p.id = d.personid
GROUP BY d.personid, p.name
```

Product aggregation is the same shape with `productid`/`product`. The
purchase/expense weight totals and document counts collapse into one more
`UNION ALL` + `GROUP BY kind` query, and the inventory summary into a single
`SELECT COUNT(*), SUM(stock), COUNT(*) FILTER (WHERE stock <= $1 AND stock > 0), …`
over `product`.

Implementation guidance:

- Put the SQL in **repository methods** (e.g.
  `PurchaseDetailsRepository.aggregateByPerson(range)`) or a small
  `AnalyticsSqlHelper` mirroring `TransactionDetailsSqlHelper`; keep
  `AnalyticsService` orchestrating and shaping the response so controllers and
  response DTOs do not change.
- Always use parameterized queries (`$1`, `$2`) — never interpolate the date
  strings.
- Top/bottom-N lists (`getTopResults`, `getTopByTransactions`) can stay in JS:
  after grouping, the result set is one row per supplier/product, which is
  small. Sorting that in JS is fine and keeps one query serving all six lists.
- Respect the `type` parameter (`purchases` | `expenses` | `both`) by building
  the union from one or both branches.
- The needed indexes already exist: `idx_purchase_date` / expense equivalent on
  the parent tables, and `purchaseid`/`expenseid`/`personid`/`productid`
  indexes on the detail tables (see the model `settings.indexes`).

## Behavioral notes to preserve

- Rows with `weight_kg <= 0` are excluded from aggregation today (`AND
  d.weight_kg > 0` keeps parity).
- `totalTransactions` in the summary counts **detail lines**, not documents;
  `purchaseCount`/`expenseCount` count documents. Both must come from the
  right level (details vs. parents).
- `pendingWeight = totalPurchaseWeight - totalExpenseWeight`.
- Weights are stored rounded to 3 decimals (`roundWeightKg`); `SUM` of those
  may still produce float noise — round the SQL sums to 3 decimals before
  returning if exact display parity matters.

## Testing

`src/__tests__/acceptance/details-report.acceptance.ts` and the analytics
acceptance coverage hit these endpoints against a real database. Migrate one
aggregation at a time and let those tests pin the response shape; add a case
with a detail in *and* a detail out of the date range to prove the JOIN
filtering matches the old two-step `inq` behavior.
