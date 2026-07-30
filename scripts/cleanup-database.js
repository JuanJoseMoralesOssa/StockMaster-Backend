const { Client } = require('pg')

const connectionString = process.env.BD_URL || 'postgresql://neondb_owner:npg_3BvQluNgpcA9@ep-empty-frost-a4vdpko6-pooler.us-east-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require'
const client = new Client({ connectionString })

async function main() {
  await client.connect()
  try {
    await client.query('BEGIN')

    await client.query('DELETE FROM public.kardex')
    await client.query('DELETE FROM public.paymentdetails')
    await client.query('DELETE FROM public.purchasedetails')
    await client.query('DELETE FROM public.purchase')
    await client.query('DELETE FROM public.payment')
    await client.query('DELETE FROM public.product')
    await client.query('DELETE FROM public.person')
    await client.query('DELETE FROM public.user')

    await client.query('COMMIT')

    console.log(JSON.stringify({
      message: 'Base limpiada: todas las entidades principales quedaron vacías.',
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
