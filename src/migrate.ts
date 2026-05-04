require('dotenv').config()

import { App } from './application'

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

async function ensureProductConstraints(app: App): Promise<void> {
  const dataSource = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  // Sanitizar datos existentes que puedan violar la restricción
  await dataSource.execute(`
    UPDATE product SET stock = 0 WHERE stock < 0;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_stock_min'
  ) THEN
    ALTER TABLE product
      ADD CONSTRAINT chk_product_stock_min
      CHECK (stock >= 0);
  END IF;
END $$;
  `)
}

async function cleanupObsoleteColumns(app: App): Promise<void> {
  const ds = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'person' AND column_name = 'active'
  ) THEN
    ALTER TABLE person DROP COLUMN active;
  END IF;
END $$;
  `)
}

async function ensureTotalViews(app: App): Promise<void> {
  const ds = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }
  await ds.execute(`
    CREATE OR REPLACE VIEW expense_with_total AS
    SELECT e.id, e.date, e.version,
           COALESCE(SUM(d.weight_kg), 0)::numeric AS total_kg
    FROM expense e
    LEFT JOIN expensedetails d ON d.expenseid = e.id
    GROUP BY e.id, e.date, e.version
  `)
  await ds.execute(`
    CREATE OR REPLACE VIEW purchase_with_total AS
    SELECT p.id, p.date, p.version,
           COALESCE(SUM(d.weight_kg), 0)::numeric AS total_kg
    FROM purchase p
    LEFT JOIN purchasedetails d ON d.purchaseid = p.id
    GROUP BY p.id, p.date, p.version
  `)
}

export async function migrate(args: string[]) {
  const existingSchema = args.includes('--rebuild') ? 'drop' : 'alter'
  console.log('Migrating schemas (%s existing schema)', existingSchema)

  const app = new App()
  await app.boot()
  await app.migrateSchema({
    existingSchema,
    models: [
      'User',
      'Person',
      'Product',
      'Expense',
      'ExpenseDetails',
      'Purchase',
      'PurchaseDetails',
      'Kardex',
    ],
  })
  await cleanupObsoleteColumns(app)
  await ensureInventoryForeignKeys(app)
  await ensureProductConstraints(app)
  await ensureTotalViews(app)

  // Connectors usually keep a pool of opened connections,
  // this keeps the process running even after all work is done.
  // We need to exit explicitly.
  process.exit(0)
}

migrate(process.argv).catch(err => {
  console.error('Cannot migrate database schema', err)
  process.exit(1)
})
