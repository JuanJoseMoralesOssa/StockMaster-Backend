import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { setupApplication } from './test-helper'

describe('InventoryStockFlow', function () {
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

  async function findLatestExpenseByDate(date: string): Promise<
    | {
        id?: number
        version?: number
        expense_details?: Array<{ id?: number }>
      }
    | undefined
  > {
    const filter = encodeURIComponent(
      JSON.stringify({
        where: { date },
        include: [{ relation: 'expense_details' }],
        order: ['id DESC'],
      }),
    )

    const res = await client
      .get(`/expenses?filter=${filter}&page=1&limit=1`)
      .expect(200)

    return res.body.data?.[0]
  }

  async function findLatestPurchaseByDate(date: string): Promise<
    | {
        id?: number
        version?: number
        purchase_details?: Array<{ id?: number }>
      }
    | undefined
  > {
    const filter = encodeURIComponent(
      JSON.stringify({
        where: { date },
        include: [{ relation: 'purchase_details' }],
        order: ['id DESC'],
      }),
    )

    const res = await client
      .get(`/purchases?filter=${filter}&page=1&limit=1`)
      .expect(200)

    return res.body.data?.[0]
  }

  it('decreases stock on expense create and restores it on delete with details', async () => {
    const tag = `expense-${Date.now()}`
    const date = '2026-02-10'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let expenseId: number | undefined

    try {
      const createResponse = await client
        .post('/expenses/with-details')
        .send({
          date,
          expenseDetails: [{ weight_kg: 12, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      expenseId = createResponse.body?.id
      if (expenseId == null) {
        const created = await findLatestExpenseByDate(date)
        expenseId = created?.id
      }

      expect(expenseId).to.be.Number()
      expect(await getStock(productId)).to.equal(88)

      await client.delete(`/expenses/${expenseId}`).expect(204)

      expect(await getStock(productId)).to.equal(100)
      await client.get(`/expenses/${expenseId}`).expect(404)
    } finally {
      if (expenseId) {
        await client.del(`/expenses/${expenseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates stock when expense detail weight changes', async () => {
    const tag = `expense-update-${Date.now()}`
    const date = '2026-02-11'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let expenseId: number | undefined

    try {
      const createResponse = await client
        .post('/expenses/with-details')
        .send({
          date,
          expenseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      const created =
        createResponse.body?.id != null
          ? createResponse.body
          : await findLatestExpenseByDate(date)
      expenseId = created?.id
      const detailId = created?.expense_details?.[0]?.id
      let parentVersion = Number(created?.version ?? 1)

      expect(expenseId).to.be.Number()
      expect(detailId).to.be.Number()
      expect(await getStock(productId)).to.equal(90)

      await client
        .patch(`/expense-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 15, productId, personId })
        .expect(res => expect([200, 204]).to.containEql(res.status))
      parentVersion += 1
      expect(await getStock(productId)).to.equal(85)

      await client
        .patch(`/expense-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 8, productId, personId })
        .expect(res => expect([200, 204]).to.containEql(res.status))
      expect(await getStock(productId)).to.equal(92)

      await client.delete(`/expenses/${expenseId}`).expect(204)
      expect(await getStock(productId)).to.equal(100)
    } finally {
      if (expenseId) {
        await client.del(`/expenses/${expenseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('increases stock on purchase create and restores it on delete with details', async () => {
    const tag = `purchase-${Date.now()}`
    const date = '2026-02-12'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date,
          purchaseDetails: [{ weight_kg: 9, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      purchaseId = createResponse.body?.id
      if (purchaseId == null) {
        const created = await findLatestPurchaseByDate(date)
        purchaseId = created?.id
      }

      expect(purchaseId).to.be.Number()
      expect(await getStock(productId)).to.equal(109)

      await client.delete(`/purchases/${purchaseId}`).expect(204)

      expect(await getStock(productId)).to.equal(100)
      await client.get(`/purchases/${purchaseId}`).expect(404)
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates stock when purchase detail weight changes', async () => {
    const tag = `purchase-update-${Date.now()}`
    const date = '2026-02-13'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date,
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      const created =
        createResponse.body?.id != null
          ? createResponse.body
          : await findLatestPurchaseByDate(date)
      purchaseId = created?.id
      const detailId = created?.purchase_details?.[0]?.id
      let parentVersion = Number(created?.version ?? 1)

      expect(purchaseId).to.be.Number()
      expect(detailId).to.be.Number()
      expect(await getStock(productId)).to.equal(110)

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 4, productId, personId })
        .expect(res => expect([200, 204]).to.containEql(res.status))
      parentVersion += 1
      expect(await getStock(productId)).to.equal(104)

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 12, productId, personId })
        .expect(res => expect([200, 204]).to.containEql(res.status))
      expect(await getStock(productId)).to.equal(112)

      await client.delete(`/purchases/${purchaseId}`).expect(204)
      expect(await getStock(productId)).to.equal(100)
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates stock when creating expense detail directly', async () => {
    const tag = `expense-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let expenseId: number | undefined

    try {
      const expenseRes = await client
        .post('/expenses')
        .send({ date: '2026-02-14' })
        .expect(200)

      expenseId = expenseRes.body?.id
      expect(expenseId).to.be.Number()

      await client
        .post('/expense-details')
        .query({ parentVersion: Number(expenseRes.body?.version ?? 1) })
        .send({ weight_kg: 5, productId, personId, expenseId })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      expect(await getStock(productId)).to.equal(95)
    } finally {
      if (expenseId) {
        await client.del(`/expenses/${expenseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates stock when creating purchase detail directly', async () => {
    const tag = `purchase-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const purchaseRes = await client
        .post('/purchases')
        .send({ date: '2026-02-15' })
        .expect(200)

      purchaseId = purchaseRes.body?.id
      expect(purchaseId).to.be.Number()

      await client
        .post('/purchase-details')
        .query({ parentVersion: Number(purchaseRes.body?.version ?? 1) })
        .send({ weight_kg: 7, productId, personId, purchaseId })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      expect(await getStock(productId)).to.equal(107)
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('blocks bulk expense detail patch for stock consistency', async () => {
    await client.patch('/expense-details').send({ weight_kg: 99 }).expect(405)
  })

  it('blocks bulk purchase detail patch for stock consistency', async () => {
    await client.patch('/purchase-details').send({ weight_kg: 99 }).expect(405)
  })

  it('blocks nested bulk expense detail patch for stock consistency', async () => {
    await client
      .patch('/expenses/999999/expense-details')
      .send({ weight_kg: 99 })
      .expect(405)
  })

  it('blocks nested bulk purchase detail patch for stock consistency', async () => {
    await client
      .patch('/purchases/999999/purchase-details')
      .send({ weight_kg: 99 })
      .expect(405)
  })

  it('blocks nested bulk expense detail delete for stock consistency', async () => {
    await client.delete('/expenses/999999/expense-details').expect(405)
  })

  it('blocks nested bulk purchase detail delete for stock consistency', async () => {
    await client.delete('/purchases/999999/purchase-details').expect(405)
  })

  it('returns 409 when deactivating product with transaction history', async () => {
    const tag = `product-refs-${Date.now()}`
    const date = '2026-02-16'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date,
          purchaseDetails: [{ weight_kg: 3, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      purchaseId = createResponse.body?.id
      if (purchaseId == null) {
        const created = await findLatestPurchaseByDate(date)
        purchaseId = created?.id
      }

      await client.delete(`/products/${productId}`).expect(409)
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('preserves stock when replacing product data', async () => {
    const tag = `product-replace-${Date.now()}`
    const productId = await createProduct(tag, 50)

    try {
      await client
        .put(`/products/${productId}`)
        .send({ name: `Product-${tag}-renamed` })
        .expect(200)

      expect(await getStock(productId)).to.equal(50)
    } finally {
      await client.del(`/products/${productId}`).catch(() => undefined)
    }
  })

  it('returns 409 when deactivating person with transaction history', async () => {
    const tag = `person-refs-${Date.now()}`
    const date = '2026-02-17'
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let expenseId: number | undefined

    try {
      const createResponse = await client
        .post('/expenses/with-details')
        .send({
          date,
          expenseDetails: [{ weight_kg: 2, productId, personId }],
        })
        .expect(res => expect([200, 204]).to.containEql(res.status))

      expenseId = createResponse.body?.id
      if (expenseId == null) {
        const created = await findLatestExpenseByDate(date)
        expenseId = created?.id
      }

      await client.delete(`/people/${personId}`).expect(409)
    } finally {
      if (expenseId) {
        await client.del(`/expenses/${expenseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('records kardex rows for direct purchase detail create and update', async () => {
    const tag = `kardex-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined
    let detailId: number | undefined

    try {
      const purchaseRes = await client
        .post('/purchases')
        .send({ date: '2026-02-18' })
        .expect(200)
      purchaseId = purchaseRes.body?.id

      const detailRes = await client
        .post('/purchase-details')
        .query({ parentVersion: Number(purchaseRes.body?.version ?? 1) })
        .send({ weight_kg: 10, productId, personId, purchaseId })
        .expect(res => expect([200, 204]).to.containEql(res.status))
      detailId = detailRes.body?.id

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion: Number(purchaseRes.body?.version ?? 1) + 1 })
        .send({ weight_kg: 4, productId, personId })
        .expect(200)

      const filter = encodeURIComponent(
        JSON.stringify({ where: { productId }, order: ['id ASC'] }),
      )
      const kardexRes = await client
        .get(`/kardexes?filter=${filter}&page=1&limit=10`)
        .expect(200)

      const rows = kardexRes.body.data
      expect(rows.length).to.be.greaterThanOrEqual(2)
      expect(rows[0]).to.containDeep({
        input: 10,
        output: 0,
        balance: 110,
        operation: 1,
        productId,
      })
      expect(rows[1]).to.containDeep({
        input: 0,
        output: 6,
        balance: 104,
        operation: 2,
        productId,
      })
    } finally {
      if (purchaseId) {
        await client.del(`/purchases/${purchaseId}`).catch(() => undefined)
      }
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('blocks manual kardex creation', async () => {
    await client
      .post('/kardexes')
      .send({
        date: new Date().toISOString(),
        input: 1,
        output: 0,
        balance: 1,
        balance_record: true,
        operation: 1,
        productId: 1,
      })
      .expect(405)
  })

  it('blocks manual kardex bulk update', async () => {
    await client.patch('/kardexes').send({ balance: 999 }).expect(405)
  })

  it('blocks manual kardex delete', async () => {
    await client.delete('/kardexes/1').expect(405)
  })
}).timeout(30000)
