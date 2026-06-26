import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { cleanupTransaction, setupApplication } from './test-helper'

// KardexOperation.OpeningBalance — the audit row written when a product is
// created with non-zero stock. Filtered out of movement assertions.
const KARDEX_OPENING_BALANCE = 5

describe('ServerSideReconciliation Flow', function () {
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

  async function createPerson(tag: string): Promise<number> {
    const res = await client
      .post('/people')
      .send({ name: `Person-${tag}` })
      .expect(200)
    return res.body.id
  }

  async function createProduct(tag: string, stock: number): Promise<number> {
    const res = await client
      .post('/products')
      .send({ name: `Product-${tag}`, stock })
      .expect(200)
    return res.body.id
  }

  async function getStock(productId: number): Promise<number> {
    const res = await client.get(`/products/${productId}`).expect(200)
    return Number(res.body.stock ?? 0)
  }

  async function countPurchasesByDate(date: string): Promise<number> {
    const where = encodeURIComponent(JSON.stringify({ date }))
    const res = await client.get(`/purchases/count?where=${where}`).expect(200)
    return Number(res.body.count ?? 0)
  }

  async function countKardexByProduct(productId: number): Promise<number> {
    const where = encodeURIComponent(JSON.stringify({ productId }))
    const res = await client.get(`/kardexes/count?where=${where}`).expect(200)
    return Number(res.body.count ?? 0)
  }

  it('rejects update when version is missing (400) or mismatched (409)', async () => {
    const tag = `concurrency-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    // Create initial purchase
    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-01',
        purchaseDetails: [{ weight_kg: 10, productId, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    expect(aggregate.version).to.equal(1)
    const detailId = aggregate.purchase_details[0].id

    // Test missing version -> 400 (service requireVersion owns the check, so it
    // is consistent with DELETE and the single-detail endpoints).
    await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        // version: Mising
        date: '2026-03-01',
        purchaseDetails: [{ id: detailId, weight_kg: 15, productId, personId }],
      })
      .expect(400)

    // Test mismatched version -> 409
    const conflictRes = await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 99, // Wrong version
        date: '2026-03-01',
        purchaseDetails: [{ id: detailId, weight_kg: 15, productId, personId }],
      })
      .expect(res => {
        if (res.status !== 409) console.log(res.body)
        expect(res.status).to.equal(409)
      })

    expect(conflictRes.body.error.message).to.match(
      /modificado por otro usuario/i,
    )

    // Verify stock did not change from rollback/abort
    expect(await getStock(productId)).to.equal(110) // 100 + 10
  })

  it('preserves version on idempotent NO-OP updates', async () => {
    const tag = `noop-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    const createRes = await client
      .post('/expenses/with-details')
      .send({
        date: '2026-03-02',
        expenseDetails: [{ weight_kg: 5, productId, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    expect(aggregate.version).to.equal(1)
    const detailId = aggregate.expense_details[0].id

    // Send exact same data
    const updateRes = await client
      .put('/expenses/with-details')
      .send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-02',
        expenseDetails: [{ id: detailId, weight_kg: 5, productId, personId }],
      })
      .expect(200)

    // Version should STILL be 1
    expect(updateRes.body.version).to.equal(1)
    // Stock remains the same
    expect(await getStock(productId)).to.equal(95)
  })

  it('rejects stale aggregate update after a single-detail patch', async () => {
    const tag = `detail-version-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-06',
        purchaseDetails: [{ weight_kg: 10, productId, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    expect(aggregate.version).to.equal(1)
    const detailId = aggregate.purchase_details[0].id

    await client
      .patch(`/purchase-details/${detailId}`)
      .query({ parentVersion: 1 })
      .send({ weight_kg: 15, productId, personId })
      .expect(200)

    await client
      .patch(`/purchase-details/${detailId}`)
      .query({ parentVersion: 1 })
      .send({ weight_kg: 20, productId, personId })
      .expect(409)

    await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-06',
        purchaseDetails: [{ id: detailId, weight_kg: 10, productId, personId }],
      })
      .expect(409)

    expect(await getStock(productId)).to.equal(115)
  })

  it('rejects negative single-detail weights without changing stock', async () => {
    const tag = `negative-weight-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-07',
        purchaseDetails: [{ weight_kg: 10, productId, personId }],
      })
      .expect(200)

    const detailId = createRes.body.purchase_details[0].id

    await client
      .patch(`/purchase-details/${detailId}`)
      .query({ parentVersion: 1 })
      .send({ weight_kg: -5, productId, personId })
      .expect(422)

    expect(await getStock(productId)).to.equal(110)
  })

  it('rejects foreign detail.id with 403 Forbidden', async () => {
    const tag = `foreign-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-03',
        purchaseDetails: [{ weight_kg: 5, productId, personId }],
      })
      .expect(200)

    const aggregate = createRes.body

    // Attempt to update with an ID that doesn't belong to this purchase
    await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-03',
        purchaseDetails: [{ id: 999999, weight_kg: 10, productId, personId }],
      })
      .expect(403)
  })

  it('allows exactly one concurrent aggregate update for the same version', async () => {
    const tag = `race-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)

    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-08',
        purchaseDetails: [{ weight_kg: 10, productId, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    const detailId = aggregate.purchase_details[0].id

    const responses = await Promise.all([
      client.put('/purchases/with-details').send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-08',
        purchaseDetails: [{ id: detailId, weight_kg: 15, productId, personId }],
      }),
      client.put('/purchases/with-details').send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-08',
        purchaseDetails: [{ id: detailId, weight_kg: 20, productId, personId }],
      }),
    ])

    const statuses = responses.map(res => res.status).sort()
    expect(statuses).to.eql([200, 409])

    const success = responses.find(res => res.status === 200)
    const finalWeight = Number(success?.body.purchase_details[0].weight_kg)
    expect([15, 20]).to.containEql(finalWeight)
    expect(await getStock(productId)).to.equal(100 + finalWeight)
  })

  it('rejects stale delete versions without changing stock', async () => {
    const tag = `delete-version-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-03-11',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createRes.body.id
      const detailId = createRes.body.purchase_details[0].id
      expect(createRes.body.version).to.equal(1)
      expect(await getStock(productId)).to.equal(110)

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion: 1 })
        .send({ weight_kg: 15, productId, personId })
        .expect(200)

      await client
        .delete(`/purchases/${purchaseId}`)
        .query({ version: 1 })
        .expect(409)

      expect(await getStock(productId)).to.equal(115)
      await client.get(`/purchases/${purchaseId}`).expect(200)

      await client
        .delete(`/purchases/${purchaseId}`)
        .query({ version: 2 })
        .expect(204)

      purchaseId = undefined
      expect(await getStock(productId)).to.equal(100)
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('rolls back purchase creation when a later detail cannot reconcile stock', async () => {
    const tag = `rollback-${Date.now()}`
    const date = '2026-03-09'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    const beforePurchaseCount = await countPurchasesByDate(date)
    const beforeKardexCount = await countKardexByProduct(productId)

    await client
      .post('/purchases/with-details')
      .send({
        date,
        purchaseDetails: [
          { weight_kg: 10, productId, personId },
          { weight_kg: 3, productId: 999999999, personId },
        ],
      })
      .expect(404)

    expect(await countPurchasesByDate(date)).to.equal(beforePurchaseCount)
    expect(await countKardexByProduct(productId)).to.equal(beforeKardexCount)
    expect(await getStock(productId)).to.equal(100)
  })

  it('rejects empty details array with 400 Bad Request', async () => {
    // on POST
    await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-04',
        purchaseDetails: [],
      })
      .expect(400)

    // on PUT
    await client
      .put('/purchases/with-details')
      .send({
        id: 1,
        version: 1,
        date: '2026-03-04',
        purchaseDetails: [],
      })
      .expect(400)
  })

  it('performs full reconciliation: creates new, updates existing, deletes missing', async () => {
    const tag = `recon-${Date.now()}`
    const personId = await createPerson(tag)
    const p1 = await createProduct(tag + '1', 100)
    const p2 = await createProduct(tag + '2', 100)

    // Initial: 1 detail of p1 (10kg)
    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-05',
        purchaseDetails: [{ weight_kg: 10, productId: p1, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    expect(aggregate.version).to.equal(1)
    const detailId_P1 = aggregate.purchase_details[0].id

    // Verify initial stock
    expect(await getStock(p1)).to.equal(110)
    expect(await getStock(p2)).to.equal(100)

    // Update: edit p1 to 15kg, add p2 (20kg)
    const updateRes = await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-05',
        purchaseDetails: [
          { id: detailId_P1, weight_kg: 15, productId: p1, personId }, // Update
          { weight_kg: 20, productId: p2, personId }, // Create
        ],
      })
      .expect(res => {
        if (res.status !== 200) console.log(res.body)
        expect(res.status).to.equal(200)
      })

    const agg2 = updateRes.body
    expect(agg2.version).to.equal(2)
    expect(agg2.purchase_details.length).to.equal(2)

    // Verify updated stock
    expect(await getStock(p1)).to.equal(115) // +5 delta
    expect(await getStock(p2)).to.equal(120) // +20 new

    // Map new details
    const d2 = agg2.purchase_details.find(
      (d: { id?: number; productId: number }) => d.productId === p2,
    )?.id

    // Update 2: Delete p1 (omit it), change p2 to 5kg
    const updateRes2 = await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 2,
        date: '2026-03-05',
        purchaseDetails: [{ id: d2, weight_kg: 5, productId: p2, personId }],
      })
      .expect(200)

    const agg3 = updateRes2.body
    expect(agg3.version).to.equal(3)
    expect(agg3.purchase_details.length).to.equal(1)

    // Verify deleted/updated stock
    expect(await getStock(p1)).to.equal(100) // Restored back to base
    expect(await getStock(p2)).to.equal(105) // Down from 120 to 105
  })

  it('rejects DELETE without a version with 400 and changes nothing', async () => {
    const tag = `delete-no-version-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-03-12',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createRes.body.id
      expect(await getStock(productId)).to.equal(110)

      // The optimistic-lock token is mandatory on delete: a stale client
      // must not be able to wipe out another user's concurrent edit.
      await client.delete(`/purchases/${purchaseId}`).expect(400)

      expect(await getStock(productId)).to.equal(110)
      await client.get(`/purchases/${purchaseId}`).expect(200)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('rolls back the whole update when a later reconciliation step fails', async () => {
    const tag = `update-rollback-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-03-13',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createRes.body.id
      const detailId = createRes.body.purchase_details[0].id
      const kardexBefore = await countKardexByProduct(productId)
      expect(await getStock(productId)).to.equal(110)

      // The update phase order is delete → update → create, so the valid
      // weight change applies first and the nonexistent product fails later.
      await client
        .put('/purchases/with-details')
        .send({
          id: purchaseId,
          version: 1,
          date: '2026-03-13',
          purchaseDetails: [
            { id: detailId, weight_kg: 15, productId, personId },
            { weight_kg: 3, productId: 999999999, personId },
          ],
        })
        .expect(404)

      // Nothing from the partially-applied update may survive the rollback.
      expect(await getStock(productId)).to.equal(110)
      expect(await countKardexByProduct(productId)).to.equal(kardexBefore)

      const includeDetails = encodeURIComponent(
        JSON.stringify({ include: [{ relation: 'purchase_details' }] }),
      )
      const after = await client
        .get(`/purchases/${purchaseId}?filter=${includeDetails}`)
        .expect(200)
      expect(after.body.version).to.equal(1)
      expect(after.body.purchase_details).to.have.length(1)
      expect(Number(after.body.purchase_details[0].weight_kg)).to.equal(10)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('allows exactly one concurrent single-detail patch for the same parentVersion', async () => {
    const tag = `detail-race-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-03-14',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createRes.body.id
      const detailId = createRes.body.purchase_details[0].id

      const responses = await Promise.all([
        client
          .patch(`/purchase-details/${detailId}`)
          .query({ parentVersion: 1 })
          .send({ weight_kg: 15, productId, personId }),
        client
          .patch(`/purchase-details/${detailId}`)
          .query({ parentVersion: 1 })
          .send({ weight_kg: 20, productId, personId }),
      ])

      const statuses = responses.map(res => res.status).sort()
      expect(statuses).to.eql([200, 409])

      const winner = responses.find(res => res.status === 200)
      const finalWeight = Number(winner?.body.weight_kg)
      expect([15, 20]).to.containEql(finalWeight)
      expect(await getStock(productId)).to.equal(100 + finalWeight)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('writes one kardex row per stock movement across the with-details lifecycle', async () => {
    const tag = `kardex-lifecycle-${Date.now()}`
    const personId = await createPerson(tag)
    const p1 = await createProduct(tag + '1', 100)
    const p2 = await createProduct(tag + '2', 100)
    let purchaseId: number | undefined

    // Excludes the opening-balance row (operation 5) written at product
    // creation, so these assertions stay focused on transaction movements.
    async function kardexRows(productId: number) {
      const filter = encodeURIComponent(
        JSON.stringify({ where: { productId }, order: ['id ASC'] }),
      )
      const res = await client
        .get(`/kardexes?filter=${filter}&page=1&limit=10`)
        .expect(200)
      return (res.body.data as Array<Record<string, unknown>>).filter(
        row => row.operation !== KARDEX_OPENING_BALANCE,
      )
    }

    try {
      // CREATE: one apply row per detail.
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-03-15',
          purchaseDetails: [
            { weight_kg: 10, productId: p1, personId },
            { weight_kg: 20, productId: p2, personId },
          ],
        })
        .expect(200)

      purchaseId = createRes.body.id
      const d1 = createRes.body.purchase_details.find(
        (d: { productId: number }) => d.productId === p1,
      )?.id

      expect(await kardexRows(p1)).to.have.length(1)
      expect(await kardexRows(p2)).to.have.length(1)

      // UPDATE: edit p1 (delta row) and drop p2 (undo row).
      await client
        .put('/purchases/with-details')
        .send({
          id: purchaseId,
          version: 1,
          date: '2026-03-15',
          purchaseDetails: [{ id: d1, weight_kg: 15, productId: p1, personId }],
        })
        .expect(200)

      const p1AfterUpdate = await kardexRows(p1)
      expect(p1AfterUpdate).to.have.length(2)
      expect(p1AfterUpdate[1]).to.containDeep({
        input: 5,
        output: 0,
        balance: 115,
        sourceKind: 'purchase',
        sourceId: purchaseId,
        sourceDetailId: d1,
        userId: 1,
      })

      const p2AfterUpdate = await kardexRows(p2)
      expect(p2AfterUpdate).to.have.length(2)
      expect(p2AfterUpdate[1]).to.containDeep({
        input: 0,
        output: 20,
        balance: 100,
        sourceKind: 'purchase',
        sourceId: purchaseId,
        userId: 1,
      })

      // DELETE: one undo row for the remaining detail.
      await client
        .delete(`/purchases/${purchaseId}`)
        .query({ version: 2 })
        .expect(204)
      purchaseId = undefined

      const p1AfterDelete = await kardexRows(p1)
      expect(p1AfterDelete).to.have.length(3)
      expect(p1AfterDelete[2]).to.containDeep({
        input: 0,
        output: 15,
        balance: 100,
        sourceKind: 'purchase',
        sourceDetailId: d1,
        userId: 1,
      })
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${p1}`).catch(() => undefined)
      await client.del(`/products/${p2}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('restores old product stock and applies new product stock when a detail changes product', async () => {
    const tag = `switch-product-${Date.now()}`
    const personId = await createPerson(tag)
    const p1 = await createProduct(tag + '1', 100)
    const p2 = await createProduct(tag + '2', 100)

    const createRes = await client
      .post('/purchases/with-details')
      .send({
        date: '2026-03-10',
        purchaseDetails: [{ weight_kg: 10, productId: p1, personId }],
      })
      .expect(200)

    const aggregate = createRes.body
    const detailId = aggregate.purchase_details[0].id
    expect(await getStock(p1)).to.equal(110)
    expect(await getStock(p2)).to.equal(100)

    await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        version: 1,
        date: '2026-03-10',
        purchaseDetails: [
          { id: detailId, weight_kg: 10, productId: p2, personId },
        ],
      })
      .expect(200)

    expect(await getStock(p1)).to.equal(100)
    expect(await getStock(p2)).to.equal(110)
  })
})
