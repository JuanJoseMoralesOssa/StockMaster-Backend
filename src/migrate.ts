require('dotenv').config()

import { App } from './application'

async function ensureLifecycleColumns(app: App): Promise<void> {
  const dataSource = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  await dataSource.execute(
    'ALTER TABLE IF EXISTS product ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE',
  )
  await dataSource.execute(
    'ALTER TABLE IF EXISTS person ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE',
  )
  await dataSource.execute(
    'UPDATE product SET active = TRUE WHERE active IS NULL',
  )
  await dataSource.execute(
    'UPDATE person SET active = TRUE WHERE active IS NULL',
  )
}

async function ensureInventoryForeignKeys(app: App): Promise<void> {
  const dataSource = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_product_restrict'
  ) THEN
    ALTER TABLE expensedetails
      ADD CONSTRAINT fk_expensedetails_product_restrict
      FOREIGN KEY (productid) REFERENCES product(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_person_restrict'
  ) THEN
    ALTER TABLE expensedetails
      ADD CONSTRAINT fk_expensedetails_person_restrict
      FOREIGN KEY (personid) REFERENCES person(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_expense_cascade'
  ) THEN
    ALTER TABLE expensedetails
      ADD CONSTRAINT fk_expensedetails_expense_cascade
      FOREIGN KEY (expenseid) REFERENCES expense(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchasedetails_product_restrict'
  ) THEN
    ALTER TABLE purchasedetails
      ADD CONSTRAINT fk_purchasedetails_product_restrict
      FOREIGN KEY (productid) REFERENCES product(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchasedetails_person_restrict'
  ) THEN
    ALTER TABLE purchasedetails
      ADD CONSTRAINT fk_purchasedetails_person_restrict
      FOREIGN KEY (personid) REFERENCES person(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchasedetails_purchase_cascade'
  ) THEN
    ALTER TABLE purchasedetails
      ADD CONSTRAINT fk_purchasedetails_purchase_cascade
      FOREIGN KEY (purchaseid) REFERENCES purchase(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_kardex_product_restrict'
  ) THEN
    ALTER TABLE kardex
      ADD CONSTRAINT fk_kardex_product_restrict
      FOREIGN KEY (productid) REFERENCES product(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)
}

export async function migrate(args: string[]) {
  const existingSchema = args.includes('--rebuild') ? 'drop' : 'alter'
  console.log('Migrating schemas (%s existing schema)', existingSchema)

  const app = new App()
  await app.boot()
  await app.migrateSchema({ existingSchema })
  await ensureLifecycleColumns(app)
  await ensureInventoryForeignKeys(app)

  // Connectors usually keep a pool of opened connections,
  // this keeps the process running even after all work is done.
  // We need to exit explicitly.
  process.exit(0)
}

migrate(process.argv).catch(err => {
  console.error('Cannot migrate database schema', err)
  process.exit(1)
})
