require('dotenv').config()

import { App } from './application'
import { DB_CONSTRAINTS } from './errors'

/**
 * Renames the legacy Expense/stock schema to the Payment/balance naming BEFORE
 * `migrateSchema` runs. `migrateSchema({existingSchema:'alter'})` only knows the
 * NEW model names (Payment, PaymentDetails, Product.balance); if the old tables
 * `expense`/`expensedetails` and the `product.stock` column still existed it
 * would CREATE fresh empty `payment`/`paymentdetails` tables and a `balance`
 * column, orphaning the existing rows. Renaming first means migrateSchema sees
 * already-correct tables/columns and only reconciles the rest of the shape.
 *
 * Every statement is guarded (IF EXISTS / column-existence / pg_constraint
 * checks) so the migration is idempotent: it is a no-op on a database that has
 * already been renamed, and safe to run repeatedly.
 */
async function renameLegacySchema(app: App): Promise<void> {
  const ds = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  // expense -> payment (only when the legacy table exists and the new one does not)
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment')
  THEN
    ALTER TABLE expense RENAME TO payment;
  END IF;
END $$;
  `)

  // expensedetails -> paymentdetails
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expensedetails')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paymentdetails')
  THEN
    ALTER TABLE expensedetails RENAME TO paymentdetails;
  END IF;
END $$;
  `)

  // paymentdetails.expenseid -> paymentdetails.paymentid
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'paymentdetails' AND column_name = 'expenseid'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'paymentdetails' AND column_name = 'paymentid'
     )
  THEN
    ALTER TABLE paymentdetails RENAME COLUMN expenseid TO paymentid;
  END IF;
END $$;
  `)

  // product.stock -> product.balance
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product' AND column_name = 'stock'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'product' AND column_name = 'balance'
     )
  THEN
    ALTER TABLE product RENAME COLUMN stock TO balance;
  END IF;
END $$;
  `)

  // Kardex provenance token: the stored sourcekind 'expense' becomes 'payment'.
  // Guarded by the column's existence (historical DBs predate the provenance cols).
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kardex' AND column_name = 'sourcekind'
     )
  THEN
    UPDATE kardex SET sourcekind = 'payment' WHERE sourcekind = 'expense';
  END IF;
END $$;
  `)

  // A table rename does NOT rename its constraints, so the legacy hand-managed
  // FKs persist on the renamed paymentdetails table under their old
  // fk_expensedetails_* names. Rename them to the new scheme so
  // ensureInventoryForeignKeys() finds them and does not ADD duplicates.
  // Guarded (old exists, new absent) → idempotent.
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_product_restrict')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_product_restrict')
  THEN
    ALTER TABLE paymentdetails RENAME CONSTRAINT fk_expensedetails_product_restrict TO fk_paymentdetails_product_restrict;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_person_restrict')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_person_restrict')
  THEN
    ALTER TABLE paymentdetails RENAME CONSTRAINT fk_expensedetails_person_restrict TO fk_paymentdetails_person_restrict;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expensedetails_expense_cascade')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_payment_cascade')
  THEN
    ALTER TABLE paymentdetails RENAME CONSTRAINT fk_expensedetails_expense_cascade TO fk_paymentdetails_payment_cascade;
  END IF;
END $$;
  `)

  // Drop the legacy total view so ensureTotalViews can recreate it under the new
  // name against the renamed tables/columns (CREATE OR REPLACE cannot rename).
  await ds.execute(`DROP VIEW IF EXISTS expense_with_total;`)
}

async function ensureInventoryForeignKeys(app: App): Promise<void> {
  const dataSource = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_product_restrict'
  ) THEN
    ALTER TABLE paymentdetails
      ADD CONSTRAINT fk_paymentdetails_product_restrict
      FOREIGN KEY (productid) REFERENCES product(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_person_restrict'
  ) THEN
    ALTER TABLE paymentdetails
      ADD CONSTRAINT fk_paymentdetails_person_restrict
      FOREIGN KEY (personid) REFERENCES person(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_paymentdetails_payment_cascade'
  ) THEN
    ALTER TABLE paymentdetails
      ADD CONSTRAINT fk_paymentdetails_payment_cascade
      FOREIGN KEY (paymentid) REFERENCES payment(id)
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
    UPDATE product SET balance = 0 WHERE balance < 0;
  `)

  // Drop the legacy check if it survived from the pre-rename schema, so the new
  // balance-named constraint can be added cleanly.
  await dataSource.execute(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_stock_min'
  ) THEN
    ALTER TABLE product DROP CONSTRAINT chk_product_stock_min;
  END IF;
END $$;
  `)

  await dataSource.execute(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '${DB_CONSTRAINTS.PRODUCT_BALANCE_MIN}'
  ) THEN
    ALTER TABLE product
      ADD CONSTRAINT ${DB_CONSTRAINTS.PRODUCT_BALANCE_MIN}
      CHECK (balance >= 0);
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

  // balance_record was hard-coded to true on every row — a flag with zero
  // information. Replaced by the provenance columns (sourcekind/sourceid/...).
  await ds.execute(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kardex' AND column_name = 'balance_record'
  ) THEN
    ALTER TABLE kardex DROP COLUMN balance_record;
  END IF;
END $$;
  `)
}

async function ensureTotalViews(app: App): Promise<void> {
  const ds = (await app.get('datasources.postgres')) as {
    execute: (sql: string) => Promise<unknown>
  }
  await ds.execute(`
    CREATE OR REPLACE VIEW payment_with_total AS
    SELECT e.id, e.date, e.version,
           COALESCE(SUM(d.weight_kg), 0)::numeric AS total_kg
    FROM payment e
    LEFT JOIN paymentdetails d ON d.paymentid = e.id
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

  // Rename the legacy Expense/stock schema to Payment/balance BEFORE migrateSchema
  // so it reconciles the already-correct tables instead of creating empty new ones
  // and orphaning data. Skipped implicitly on a --rebuild (drop) run since the
  // guards are no-ops once the tables are dropped/recreated.
  await renameLegacySchema(app)

  await app.migrateSchema({
    existingSchema,
    models: [
      'User',
      'Person',
      'Product',
      'Payment',
      'PaymentDetails',
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
