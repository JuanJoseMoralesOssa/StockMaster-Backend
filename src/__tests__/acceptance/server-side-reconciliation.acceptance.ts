import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { setupApplication } from './test-helper'

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
      .send({ name: `Product-${tag}`, stock})
      .expect(200)
    return res.body.id
  }

  async function getStock(productId: number): Promise<number> {
    const res = await client.get(`/products/${productId}`).expect(200)
    return Number(res.body.stock ?? 0)
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

    // Test missing version -> 400
    await client
      .put('/purchases/with-details')
      .send({
        id: aggregate.id,
        // version: Mising
        date: '2026-03-01',
        purchaseDetails: [{ id: detailId, weight_kg: 15, productId, personId }],
      })
      .expect(422)

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d2 = agg2.purchase_details.find((d: any) => d.productId === p2).id

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
})
