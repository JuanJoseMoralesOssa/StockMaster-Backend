import { TransactionKind } from './transaction-kind.enum'

export type TransactionContext = {
  commit(): Promise<void> | void
  rollback(): Promise<void> | void
}

export type TransactionOptions = {
  transaction: TransactionContext
}

/**
 * The ambient execution context every detail/balance engine method needs, bundled
 * into one value so it is threaded as a single parameter instead of the old
 * 4-element (dataSource, transactionKind, options, actorId) clump (audit Finding
 * M3). Built once inside `runInTransaction` (where `options` exists) and passed
 * down; this also removes the `tx` vs `tx.transaction` footgun since callers
 * read `scope.options` / `scope.options.transaction` explicitly.
 *
 * `actorId` is the authenticated user stamped onto Kardex rows. It is resolved
 * at the request-scoped facade boundary and passed in EXPLICITLY, so the
 * low-level balance engine no longer reaches up into request/auth context to get
 * it (audit Finding M5).
 */
export type TxScope = {
  dataSource: DataSourceWithTransactions
  transactionKind: TransactionKind
  options: TransactionOptions
  actorId?: number
}

export type DataSourceWithTransactions = {
  beginTransaction?(options?: {
    isolationLevel?: string
  }): Promise<TransactionContext>
  transaction?<T>(work: (tx: unknown) => Promise<T>): Promise<T>
  execute(
    sql: string,
    params?: unknown[],
    options?: TransactionOptions,
  ): Promise<unknown>
}

export type DetailBase = {
  id?: number
  weight_kg: number
  productId: number
  personId: number
}

/**
 * Request shapes accepted by the per-kind `with-details` facade methods. Shared
 * by the purchase and payment facades (and structurally identical for both)
 * instead of being re-declared per kind (audit duplicate-DTO finding).
 */
export type WithDetailsCreateInput = {
  date: string
  details?: DetailBase[]
}

export type WithDetailsUpdateInput = {
  id: number
  version?: number
  date?: string
  details?: DetailBase[]
}

export type RelationAccessor<TDetail extends DetailBase = DetailBase> = {
  create(data: Partial<TDetail>, options?: TransactionOptions): Promise<TDetail>
  find(filter?: object, options?: TransactionOptions): Promise<TDetail[]>
  delete(where?: object, options?: TransactionOptions): Promise<unknown>
}

export type RelationFactory<TDetail extends DetailBase = DetailBase> = (
  id: number,
) => RelationAccessor<TDetail>

export type TransactionRepository<
  TEntity extends { id?: number } = { id?: number },
> = {
  dataSource: DataSourceWithTransactions
  create(data: Partial<TEntity>, options?: TransactionOptions): Promise<TEntity>
  findById(
    id: number,
    filter?: object,
    options?: TransactionOptions,
  ): Promise<TEntity>
  updateById(
    id: number,
    data: Partial<TEntity>,
    options?: TransactionOptions,
  ): Promise<void>
  deleteById(id: number, options?: TransactionOptions): Promise<void>
}

export type DetailRepository<TDetail extends DetailBase = DetailBase> = {
  dataSource: DataSourceWithTransactions
  findById(
    id: number,
    filter?: object,
    options?: TransactionOptions,
  ): Promise<TDetail>
  updateById(
    id: number,
    data: Partial<TDetail>,
    options?: TransactionOptions,
  ): Promise<void>
  deleteById(id: number, options?: TransactionOptions): Promise<void>
}
