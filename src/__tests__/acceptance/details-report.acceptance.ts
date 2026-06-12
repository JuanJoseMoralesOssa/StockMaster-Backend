import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { cleanupTransaction, setupApplication } from './test-helper'

describe('Details reports and analytics', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let client: Client

  before('setupApplication', async () => {
    ;({ app, client } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  it('rejects malformed supplier-product date filters with 400', async () => {
    await client
      .get(
        '/reports/details/supplier/1/product/1?startDate=not-a-date&endDate=2026-04-01',
      )
      .expect(400)
  })

  // Seeds + asserts + cleans up over ~14 round trips against a remote
  // serverless database, so it needs a wider budget than the suite default.
  it('aggregates the dashboard summary from seeded transactions', async function () {
    // eslint-disable-next-line @typescript-eslint/no-invalid-this
    this.timeout(90000)
    // Isolated, otherwise-unused date range so range-scoped counts are exact.
    const tag = `dashboard-${Date.now()}`
    const startDate = '2001-07-13'
    const endDate = '2001-07-14'
    let personId: number | undefined
    let p1: number | undefined
    let p2: number | undefined
    let purchaseId: number | undefined
    let expenseId: number | undefined

    // Self-healing: a previously crashed/timed-out run can leave documents in
    // this reserved range, which would skew the exact-count assertions below.
    async function purgeRange(basePath: '/purchases' | '/expenses') {
      const res = await client
        .get(`${basePath}/filtered`)
        .query({ startDate, endDate, page: 1, limit: 100 })
        .expect(200)
      for (const doc of res.body.data ?? []) {
        await cleanupTransaction(client, basePath, doc.id)
      }
    }
    await purgeRange('/purchases')
    await purgeRange('/expenses')

    try {
      personId = (
        await client
          .post('/people')
          .send({ name: `Person-${tag}` })
          .expect(200)
      ).body.id
      p1 = (
        await client
          .post('/products')
          .send({ name: `Product-${tag}-1`, stock: 100 })
          .expect(200)
      ).body.id
      p2 = (
        await client
          .post('/products')
          .send({ name: `Product-${tag}-2`, stock: 100 })
          .expect(200)
      ).body.id

      purchaseId = (
        await client
          .post('/purchases/with-details')
          .send({
            date: startDate,
            purchaseDetails: [
              { weight_kg: 10, productId: p1, personId },
              { weight_kg: 20, productId: p2, personId },
            ],
          })
          .expect(200)
      ).body.id

      expenseId = (
        await client
          .post('/expenses/with-details')
          .send({
            date: endDate,
            expenseDetails: [{ weight_kg: 5, productId: p1, personId }],
          })
          .expect(200)
      ).body.id

      const res = await client
        .get('/analytics/dashboard-summary')
        .query({ startDate, endDate, type: 'both' })
        .expect(200)

      expect(res.body.summary).to.containDeep({
        totalSuppliers: 1,
        totalProducts: 2,
        totalWeight: 35,
        totalTransactions: 3,
        purchaseCount: 1,
        expenseCount: 1,
        totalPurchaseWeight: 30,
        totalExpenseWeight: 5,
        pendingWeight: 25,
      })

      expect(res.body.topSuppliersByWeight).to.containDeep([
        { personId, totalWeight: 35, transactionCount: 3 },
      ])
      expect(res.body.topProductsByWeight).to.containDeep([
        { productId: p2, totalWeight: 20, transactionCount: 1 },
        { productId: p1, totalWeight: 15, transactionCount: 2 },
      ])

      // Drill-down report for the same data, interleaved chronologically.
      const drill = await client
        .get(`/reports/details/person/${personId}/product/${p1}`)
        .query({ startDate, endDate })
        .expect(200)

      expect(drill.body).to.have.length(2)
      expect(drill.body[0]).to.containDeep({ weight_kg: 10, type: 'Compra' })
      expect(drill.body[1]).to.containDeep({ weight_kg: 5, type: 'Gasto' })
    } finally {
      await cleanupTransaction(client, '/expenses', expenseId)
      await cleanupTransaction(client, '/purchases', purchaseId)
      if (p1) await client.del(`/products/${p1}`).catch(() => undefined)
      if (p2) await client.del(`/products/${p2}`).catch(() => undefined)
      if (personId) {
        await client.del(`/people/${personId}`).catch(() => undefined)
      }
    }
  })
})
