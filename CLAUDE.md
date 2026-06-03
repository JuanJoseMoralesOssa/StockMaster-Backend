# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript via lb-tsc
npm run rebuild        # Clean + build (full recompile)
npm start              # rebuild + run with source maps
npm test               # rebuild + run all tests + lint
npm run test:coverage  # tests with coverage report
npm run lint           # eslint + prettier check
npm run lint:fix       # auto-fix lint and formatting
npm run migrate        # run DB schema migrations
npm run create-admin   # create initial admin user (run once)
```

To run a single test file after building:

```bash
npx lb-mocha --allow-console-logs "dist/__tests__/acceptance/inventory-stock.acceptance.js"
```

Tests require a live PostgreSQL database (acceptance tests hit it directly — no mocks).

## Environment variables

Copy and fill in for local development:

| Variable | Purpose | Default |
|---|---|---|
| `BD_URL` | PostgreSQL connection URL | `postgresql://postgres:postgres@localhost:5432/postgres?sslmode=verify-full` |
| `BD_HOST/PORT/USER/PASSWORD/DATABASE` | Individual DB params (override URL) | see above |
| `JWT_SECRET` | JWT signing secret (**required in production**) | `default_secret` |
| `JWT_EXPIRATION` | Token lifetime | `1d` |
| `FRONTEND_ORIGIN` | Comma-separated CORS origins | `http://localhost:5173` |
| `PORT` / `HOST` | Server bind | `3000` / `127.0.0.1` |

## Architecture overview

LoopBack 4 REST API backed by PostgreSQL. The domain is an inventory system tracking **purchases** (stock in) and **expenses** (stock out) of weighted products, with a Kardex audit trail and an AI-assisted form-extraction feature.

### Layer structure

```
src/
  application.ts          # App bootstrap: auth, rate limiting, CORS
  sequence.ts             # Thin MiddlewareSequence wrapper
  auth/                   # JWT strategy + RBAC decorators + global interceptor
  config/                 # database.ts, security.ts, pagination.ts
  datasources/            # PostgresDataSource (LoopBack juggler)
  models/
    entities/             # LoopBack @model classes (Purchase, Expense, Kardex, …)
    types/                # Non-entity types: Credentials, TokenPayload, Pagination
  repositories/           # DefaultCrudRepository subclasses + custom query methods
  services/               # Business logic (no HTTP concerns)
  interceptors/           # Global error normalizer
  controllers/
    health/               # /ping, /health (unauthenticated)
    logic/auth/           # /sign-in, /whoami
    logic/reports/        # /analytics/… (OFFICE + ADMIN only)
    rest/                 # CRUD endpoints per entity
```

### Authentication and authorization

Every endpoint requires a valid JWT by default (configured in `application.ts` via `AuthenticationBindings.COMPONENT` `defaultMetadata`). Public endpoints opt out with `@authenticate.skip()`. Role enforcement is layered on top:

- `@requireRoles(Roles.ADMIN, Roles.OFFICE)` on a **class** applies to all methods.
- A `@requireRoles(...)` on an individual **method** overrides the class decorator.
- The `AuthorizeInterceptor` (global) reads `Reflect.getMetadata` to enforce these at runtime.

Roles are defined in `src/auth/roles.ts` as a const object (`admin`, `office`, `operator`) — keep these in sync with the frontend enum.

### Transaction + stock model

The critical invariant: **every mutation to `purchase_details` or `expense_details` must atomically update `product.stock` and insert a `kardex` record**. This is enforced by:

1. `TransactionService` — orchestrates create/update/delete of a transaction with its detail rows inside a DB transaction.
2. `StockReconciliationService` — executes the raw SQL `UPDATE product SET stock = …` and writes the Kardex row.
3. Controllers delegate all writes to these services; direct bulk PATCH on detail tables returns 405.

The `version` field on Purchase/Expense is an optimistic-lock counter. `PUT /purchases/with-details` and `PUT /expenses/with-details` require the client to send the current version; a mismatch returns 409.

### Dual-model read pattern

`Purchase` / `Expense` are used for **writes**. `PurchaseWithTotal` / `ExpenseWithTotal` are separate LoopBack models (mapped to the same table via a DB view or virtual column) used for **reads** — they add a computed `total` field. Both have paired repositories; controllers inject both.

### AI form extraction

`POST /purchases/extract` accepts a multipart image upload (max 15 MB, images only). The pipeline:

1. `PurchaseExtractController` parses the file via multer (in-memory, never persisted).
2. `FormExtractionService` calls a `FormVisionProvider` (Claude by default, swappable) to get raw fields.
3. `form-extraction.normalizer.ts` maps raw fields to structured `ExtractionResult` with fuzzy-matched people/product IDs and confidence scores.

Rate-limited to 60 requests/hour per IP.

### Controller organization

Controllers in `rest/` follow LoopBack's generated relation-controller pattern — one file per relation (e.g., `purchase-purchase-details.controller.ts`, `purchase-person.controller.ts`). The main entity controller (`expense.controller.ts`, `purchase.controller.ts`) handles CRUD + the composite `with-details` endpoints.

`logic/` controllers contain non-CRUD operations: auth and analytics reports.

### Testing

Acceptance tests in `src/__tests__/acceptance/` spin up a real `App` instance against a live database. `test-helper.ts` generates a synthetic admin JWT (no DB user required) and proxies the `Client` to attach it to every request automatically. Tests are self-cleaning via `finally` blocks.

Unit tests in `src/__tests__/unit/` cover pure functions (normalizer, weight rounding, security service).
