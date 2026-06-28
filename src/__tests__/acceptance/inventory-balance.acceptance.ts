import { Client, expect } from '@loopback/testlab'
import { App } from '../..'
import { cleanupTransaction, setupApplication } from './test-helper'

describe('InventoryBalanceFlow', function () {
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

  async function createProduct(tag: string, balance: number): Promise<number> {
    const res = await client
      .post('/products')
      .send({ name: `Product-${tag}`, balance })
      .expect(200)
    return res.body.id
  }

  async function getBalance(productId: number): Promise<number> {
    const res = await client.get(`/products/${productId}`).expect(200)
    return Number(res.body.balance ?? 0)
  }

  it('decreases balance on payment create and restores it on delete with details', async () => {
    const tag = `payment-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let paymentId: number | undefined

    try {
      const createResponse = await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-10',
          paymentDetails: [{ weight_kg: 12, productId, personId }],
        })
        .expect(200)

      paymentId = createResponse.body.id
      expect(paymentId).to.be.Number()
      expect(createResponse.body.version).to.equal(1)
      expect(await getBalance(productId)).to.equal(88)

      await client
        .delete(`/payments/${paymentId}`)
        .query({ version: 1 })
        .expect(204)

      expect(await getBalance(productId)).to.equal(100)
      await client.get(`/payments/${paymentId}`).expect(404)
    } finally {
      await cleanupTransaction(client, '/payments', paymentId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates balance when payment detail weight changes', async () => {
    const tag = `payment-update-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let paymentId: number | undefined

    try {
      const createResponse = await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-11',
          paymentDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      paymentId = createResponse.body.id
      const detailId = createResponse.body.payment_details?.[0]?.id
      let parentVersion = Number(createResponse.body.version)

      expect(paymentId).to.be.Number()
      expect(detailId).to.be.Number()
      expect(await getBalance(productId)).to.equal(90)

      await client
        .patch(`/payment-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 15, productId, personId })
        .expect(200)
      parentVersion += 1
      expect(await getBalance(productId)).to.equal(85)

      await client
        .patch(`/payment-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 8, productId, personId })
        .expect(200)
      parentVersion += 1
      expect(await getBalance(productId)).to.equal(92)

      await client
        .delete(`/payments/${paymentId}`)
        .query({ version: parentVersion })
        .expect(204)
      expect(await getBalance(productId)).to.equal(100)
    } finally {
      await cleanupTransaction(client, '/payments', paymentId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('increases balance on purchase create and restores it on delete with details', async () => {
    const tag = `purchase-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-12',
          purchaseDetails: [{ weight_kg: 9, productId, personId }],
        })
        .expect(200)

      purchaseId = createResponse.body.id
      expect(purchaseId).to.be.Number()
      expect(createResponse.body.version).to.equal(1)
      expect(await getBalance(productId)).to.equal(109)

      await client
        .delete(`/purchases/${purchaseId}`)
        .query({ version: 1 })
        .expect(204)

      expect(await getBalance(productId)).to.equal(100)
      await client.get(`/purchases/${purchaseId}`).expect(404)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates balance when purchase detail weight changes', async () => {
    const tag = `purchase-update-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-13',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createResponse.body.id
      const detailId = createResponse.body.purchase_details?.[0]?.id
      let parentVersion = Number(createResponse.body.version)

      expect(purchaseId).to.be.Number()
      expect(detailId).to.be.Number()
      expect(await getBalance(productId)).to.equal(110)

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 4, productId, personId })
        .expect(200)
      parentVersion += 1
      expect(await getBalance(productId)).to.equal(104)

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion })
        .send({ weight_kg: 12, productId, personId })
        .expect(200)
      parentVersion += 1
      expect(await getBalance(productId)).to.equal(112)

      await client
        .delete(`/purchases/${purchaseId}`)
        .query({ version: parentVersion })
        .expect(204)
      expect(await getBalance(productId)).to.equal(100)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates balance when creating payment detail directly', async () => {
    const tag = `payment-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let paymentId: number | undefined

    try {
      const paymentRes = await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-14',
          paymentDetails: [{ weight_kg: 1, productId, personId }],
        })
        .expect(200)

      paymentId = paymentRes.body.id
      expect(paymentId).to.be.Number()
      expect(await getBalance(productId)).to.equal(99)

      await client
        .post('/payment-details')
        .query({ parentVersion: Number(paymentRes.body.version) })
        .send({ weight_kg: 5, productId, personId, paymentId })
        .expect(200)

      expect(await getBalance(productId)).to.equal(94)
    } finally {
      await cleanupTransaction(client, '/payments', paymentId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('updates balance when creating purchase detail directly', async () => {
    const tag = `purchase-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const purchaseRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-15',
          purchaseDetails: [{ weight_kg: 1, productId, personId }],
        })
        .expect(200)

      purchaseId = purchaseRes.body.id
      expect(purchaseId).to.be.Number()
      expect(await getBalance(productId)).to.equal(101)

      await client
        .post('/purchase-details')
        .query({ parentVersion: Number(purchaseRes.body.version) })
        .send({ weight_kg: 7, productId, personId, purchaseId })
        .expect(200)

      expect(await getBalance(productId)).to.equal(108)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('PUT /purchase-details/{id} replaces the whole line and rejects a partial body', async () => {
    const tag = `put-replace-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-04-01',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createRes.body.id
      const detailId = createRes.body.purchase_details[0].id
      expect(await getBalance(productId)).to.equal(110)

      // PUT requires the full representation: a partial body is rejected (422)
      // and leaves balance/version untouched.
      await client
        .put(`/purchase-details/${detailId}`)
        .query({ parentVersion: 1 })
        .send({ weight_kg: 20 })
        .expect(422)
      expect(await getBalance(productId)).to.equal(110)

      // Full representation replaces the line.
      await client
        .put(`/purchase-details/${detailId}`)
        .query({ parentVersion: 1 })
        .send({ weight_kg: 20, productId, personId })
        .expect(200)
      expect(await getBalance(productId)).to.equal(120)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('blocks bulk payment detail patch for balance consistency', async () => {
    await client.patch('/payment-details').send({ weight_kg: 99 }).expect(405)
  })

  it('blocks bulk purchase detail patch for balance consistency', async () => {
    await client.patch('/purchase-details').send({ weight_kg: 99 }).expect(405)
  })

  it('blocks nested bulk payment detail patch for balance consistency', async () => {
    await client
      .patch('/payments/999999/payment-details')
      .send({ weight_kg: 99 })
      .expect(405)
  })

  it('blocks nested bulk purchase detail patch for balance consistency', async () => {
    await client
      .patch('/purchases/999999/purchase-details')
      .send({ weight_kg: 99 })
      .expect(405)
  })

  it('blocks nested bulk payment detail delete for balance consistency', async () => {
    await client.delete('/payments/999999/payment-details').expect(405)
  })

  it('blocks nested bulk purchase detail delete for balance consistency', async () => {
    await client.delete('/purchases/999999/purchase-details').expect(405)
  })

  it('blocks plain transaction parent creation without details', async () => {
    await client.post('/purchases').send({ date: '2026-02-22' }).expect(405)
    await client.post('/payments').send({ date: '2026-02-22' }).expect(405)
  })

  it('blocks purchase-product relation writes for balance consistency', async () => {
    const tag = `purchase-products-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-19',
          purchaseDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      purchaseId = createResponse.body.id
      expect(await getBalance(productId)).to.equal(110)

      await client
        .post(`/purchases/${purchaseId}/products`)
        .send({ name: `Relation-${tag}`, balance: 9999 })
        .expect(405)

      await client
        .patch(`/purchases/${purchaseId}/products`)
        .send({ balance: 9999 })
        .expect(405)

      await client.delete(`/purchases/${purchaseId}/products`).expect(405)
      expect(await getBalance(productId)).to.equal(110)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('blocks payment-product relation writes for balance consistency', async () => {
    const tag = `payment-products-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let paymentId: number | undefined

    try {
      const createResponse = await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-20',
          paymentDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(200)

      paymentId = createResponse.body.id
      expect(await getBalance(productId)).to.equal(90)

      await client
        .post(`/payments/${paymentId}/products`)
        .send({ name: `Relation-${tag}`, balance: 9999 })
        .expect(405)

      await client
        .patch(`/payments/${paymentId}/products`)
        .send({ balance: 9999 })
        .expect(405)

      await client.delete(`/payments/${paymentId}/products`).expect(405)
      expect(await getBalance(productId)).to.equal(90)
    } finally {
      await cleanupTransaction(client, '/payments', paymentId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('returns 409 when deactivating product with transaction history', async () => {
    const tag = `product-refs-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let purchaseId: number | undefined

    try {
      const createResponse = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-16',
          purchaseDetails: [{ weight_kg: 3, productId, personId }],
        })
        .expect(200)

      purchaseId = createResponse.body.id
      await client.delete(`/products/${productId}`).expect(409)
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('preserves balance when replacing product data', async () => {
    const tag = `product-replace-${Date.now()}`
    const productId = await createProduct(tag, 50)

    try {
      await client
        .put(`/products/${productId}`)
        .send({ name: `Product-${tag}-renamed`, balance: 9999 })
        .expect(200)

      expect(await getBalance(productId)).to.equal(50)
    } finally {
      await client.del(`/products/${productId}`).catch(() => undefined)
    }
  })

  it('preserves balance when patching product data', async () => {
    const tag = `product-patch-${Date.now()}`
    const productId = await createProduct(tag, 50)

    try {
      await client
        .patch(`/products/${productId}`)
        .send({ name: `Product-${tag}-renamed`, balance: 9999 })
        .expect(200)

      expect(await getBalance(productId)).to.equal(50)
    } finally {
      await client.del(`/products/${productId}`).catch(() => undefined)
    }
  })

  it('preserves balance on scoped bulk product patch', async () => {
    const tag = `product-bulk-patch-${Date.now()}`
    const productId = await createProduct(tag, 50)

    try {
      const where = encodeURIComponent(JSON.stringify({ id: productId }))
      await client
        .patch(`/products?where=${where}`)
        .send({ name: `Product-${tag}-renamed`, balance: 9999 })
        .expect(200)

      expect(await getBalance(productId)).to.equal(50)
    } finally {
      await client.del(`/products/${productId}`).catch(() => undefined)
    }
  })

  it('returns 409 when deactivating person with transaction history', async () => {
    const tag = `person-refs-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    let paymentId: number | undefined

    try {
      const createResponse = await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-17',
          paymentDetails: [{ weight_kg: 2, productId, personId }],
        })
        .expect(200)

      paymentId = createResponse.body.id
      await client.delete(`/people/${personId}`).expect(409)
    } finally {
      await cleanupTransaction(client, '/payments', paymentId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('returns 409 and preserves balance when an payment overdrafts balance', async () => {
    const tag = `overdraw-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 5)

    try {
      await client
        .post('/payments/with-details')
        .send({
          date: '2026-02-21',
          paymentDetails: [{ weight_kg: 10, productId, personId }],
        })
        .expect(409)

      expect(await getBalance(productId)).to.equal(5)
    } finally {
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('records kardex rows with provenance for direct purchase detail create and update', async () => {
    const tag = `kardex-direct-${Date.now()}`
    const personId = await createPerson(tag)
    const productId = await createProduct(tag, 100)
    const seedProductId = await createProduct(`${tag}-seed`, 100)
    let purchaseId: number | undefined
    let detailId: number | undefined

    try {
      const purchaseRes = await client
        .post('/purchases/with-details')
        .send({
          date: '2026-02-18',
          purchaseDetails: [
            { weight_kg: 1, productId: seedProductId, personId },
          ],
        })
        .expect(200)
      purchaseId = purchaseRes.body.id

      const detailRes = await client
        .post('/purchase-details')
        .query({ parentVersion: Number(purchaseRes.body.version) })
        .send({ weight_kg: 10, productId, personId, purchaseId })
        .expect(200)
      detailId = detailRes.body.id

      await client
        .patch(`/purchase-details/${detailId}`)
        .query({ parentVersion: Number(purchaseRes.body.version) + 1 })
        .send({ weight_kg: 4, productId, personId })
        .expect(200)

      const filter = encodeURIComponent(
        JSON.stringify({ where: { productId }, order: ['id ASC'] }),
      )
      const kardexRes = await client
        .get(`/kardexes?filter=${filter}&page=1&limit=10`)
        .expect(200)

      // Exclude the opening-balance row (operation 5) so indices line up with
      // the transaction movements asserted below.
      const rows = (
        kardexRes.body.data as Array<Record<string, unknown>>
      ).filter(row => row.operation !== 5)
      expect(rows.length).to.be.greaterThanOrEqual(2)
      expect(rows[0]).to.containDeep({
        input: 10,
        output: 0,
        balance: 110,
        operation: 1,
        productId,
        // Provenance: the document, line, and user that caused the movement.
        sourceKind: 'purchase',
        sourceId: purchaseId,
        sourceDetailId: detailId,
        userId: 1,
      })
      expect(rows[1]).to.containDeep({
        input: 0,
        output: 6,
        balance: 104,
        operation: 2,
        productId,
        sourceKind: 'purchase',
        sourceId: purchaseId,
        sourceDetailId: detailId,
        userId: 1,
      })
    } finally {
      await cleanupTransaction(client, '/purchases', purchaseId)
      await client.del(`/products/${productId}`).catch(() => undefined)
      await client.del(`/products/${seedProductId}`).catch(() => undefined)
      await client.del(`/people/${personId}`).catch(() => undefined)
    }
  })

  it('records an opening-balance kardex row when a product is created with balance', async () => {
    const tag = `opening-balance-${Date.now()}`
    let withBalanceId: number | undefined
    let zeroBalanceId: number | undefined

    try {
      withBalanceId = await createProduct(tag, 50)
      zeroBalanceId = await createProduct(`${tag}-zero`, 0)

      const openingFilter = encodeURIComponent(
        JSON.stringify({
          where: { productId: withBalanceId },
          order: ['id ASC'],
        }),
      )
      const openingRes = await client
        .get(`/kardexes?filter=${openingFilter}&page=1&limit=10`)
        .expect(200)

      expect(openingRes.body.data).to.have.length(1)
      expect(openingRes.body.data[0]).to.containDeep({
        input: 50,
        output: 0,
        balance: 50,
        operation: 5, // KardexOperation.OpeningBalance
        productId: withBalanceId,
      })

      // A product created with zero balance writes no opening movement.
      const zeroFilter = encodeURIComponent(
        JSON.stringify({ where: { productId: zeroBalanceId } }),
      )
      const zeroRes = await client
        .get(`/kardexes?filter=${zeroFilter}&page=1&limit=10`)
        .expect(200)
      expect(zeroRes.body.data).to.have.length(0)
    } finally {
      if (withBalanceId) {
        await client.del(`/products/${withBalanceId}`).catch(() => undefined)
      }
      if (zeroBalanceId) {
        await client.del(`/products/${zeroBalanceId}`).catch(() => undefined)
      }
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
