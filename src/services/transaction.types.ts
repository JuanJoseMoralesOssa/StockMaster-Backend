export type TransactionContext = unknown

export type TransactionOptions = {
  transaction: TransactionContext
}

export type DataSourceWithTransactions = {
  transaction?<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>
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
  personId?: number
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
