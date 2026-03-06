import { /* inject, */ BindingScope, injectable} from '@loopback/core'
import {repository} from '@loopback/repository'
import {HttpErrors} from '@loopback/rest'
import {KardexRepository} from '../repositories'

type TransactionContext = unknown

type TransactionOptions = {
  transaction: TransactionContext
}

type DataSourceWithTransactions = {
  transaction?<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>
  execute(
    sql: string,
    params?: unknown[],
    options?: TransactionOptions,
  ): Promise<unknown>
}

type DetailBase = {
  id?: number
  weight_kg: number
  productId: number
  personId?: number
}

type RelationAccessor<TDetail extends DetailBase = DetailBase> = {
  create(data: Partial<TDetail>, options?: TransactionOptions): Promise<TDetail>
  find(filter?: object, options?: TransactionOptions): Promise<TDetail[]>
  delete(where?: object, options?: TransactionOptions): Promise<unknown>
}

type RelationFactory<TDetail extends DetailBase = DetailBase> = (
  id: number,
) => RelationAccessor<TDetail>

type DetailRelationConfig = {
  tableName: string
  parentIdField: string
}

type StockMutationMode = 'apply' | 'undo'

const DETAIL_RELATION_CONFIG: Record<string, DetailRelationConfig> = {
  expense_details: {
    tableName: 'expensedetails',
    parentIdField: 'expenseId',
  },
  purchase_details: {
    tableName: 'purchasedetails',
    parentIdField: 'purchaseId',
  },
}

type TransactionRepository<TEntity extends {id?: number} = {id?: number}> =
  {
    dataSource: DataSourceWithTransactions
    create(
      data: Partial<TEntity> & {total_kg?: number},
      options?: TransactionOptions,
    ): Promise<TEntity>
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

type DetailRepository<TDetail extends DetailBase = DetailBase> = {
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

@injectable({scope: BindingScope.TRANSIENT})
export class TransactionService {
  constructor(
    @repository(KardexRepository)
    private readonly kardexRepository: KardexRepository,
  ) { }

  /**
   * Lógica compartida para crear transacción con detalles
   */
  async createWithDetails<
    T extends {id?: number; date: string; total_kg?: number},
    D extends {weight_kg: number; productId: number; personId: number},
  >(
    transactionData: Partial<T> & {details?: D[]},
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<T> {
    // Validar fecha
    this.validateDate(transactionData.date!)

    // Calcular total_kg
    const totalKg = this.calculateTotalWeight(transactionData.details)

    try {
      // Usar transacción real para garantizar atomicidad e incluir stock
      const result = await this.runInTransaction(
        transactionRepository.dataSource,
        async (tx: TransactionContext) => {
          // Extraer los detalles y crear un objeto limpio para el modelo principal
          const {details, ...cleanTransactionData} = transactionData
          const createPayload = {
            ...cleanTransactionData,
            total_kg: totalKg,
          } as Partial<T> & {total_kg: number}

          // Crear transacción principal (sin la propiedad details)
          const transaction = await transactionRepository.create(
            createPayload,
            {
              transaction: tx,
            },
          )
          const transactionId = transaction.id

          if (transactionId == null) {
            throw new HttpErrors.BadRequest(
              'Created transaction does not contain an id',
            )
          }

          // Crear detalles y actualizar stock en paralelo
          if (details && details.length > 0) {
            const detailsRelation = this.getRelationAccessor<T, D>(
              transactionRepository,
              detailsRelationName,
              transactionId,
            )

            const detailPromises = details.map(async detail => {
              // 1. Crear el detalle
              await detailsRelation.create(
                {
                  weight_kg: detail.weight_kg,
                  productId: detail.productId,
                  personId: detail.personId,
                } as Partial<D>,
                {transaction: tx},
              )

              // 2. Actualizar el stock del producto de forma síncrona/atómica
              await this.adjustStock(
                transactionRepository.dataSource,
                detail.productId,
                detail.weight_kg,
                isPurchase,
                'apply',
                tx,
              )
            })
            await Promise.all(detailPromises)
          }

          return transactionRepository.findById(
            transactionId,
            {
              include: [detailsRelationName],
            },
            {transaction: tx},
          )
        },
      )

      return result
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error creating transaction with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Lógica compartida para actualizar transacción con detalles (crear, actualizar, eliminar)
   * Versión optimizada con transacciones reales y operaciones batch
   */
  async updateWithDetails<
    T extends {id?: number; date?: string; total_kg?: number},
    D extends {
      id?: number
      weight_kg?: number
      productId?: number
      personId?: number
      toCreate?: boolean
      toUpdate?: boolean
      toDelete?: boolean
    },
  >(
    transactionData: Partial<Omit<T, 'id'>> & {id: number; details?: D[]},
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
  ): Promise<T> {
    if (!transactionData.id) {
      throw new HttpErrors.BadRequest('Transaction ID is required for update')
    }

    // Validar fecha si está presente
    if (transactionData.date) {
      this.validateDate(transactionData.date)
    }

    try {
      const details = transactionData.details ?? []

      // Validar que todos los detalles tengan los datos necesarios
      this.validateDetailsForUpdate(details)

      // Separar operaciones por tipo para optimización batch
      const toDelete = details.filter(d => d.toDelete && d.id)
      const toUpdate = details.filter(d => d.toUpdate && d.id)
      const toCreate = details.filter(d => d.toCreate)

      // Usar transacción real para garantizar atomicidad
      const result = await this.runInTransaction(
        transactionRepository.dataSource,
        async (tx: TransactionContext) => {
          // 1. OPERACIÓN BATCH: Eliminaciones (más eficiente que individual)
          if (toDelete.length > 0) {
            const deleteIds = toDelete.map(d => d.id!)
            const tableName = this.getTableName(detailsRelationName)
            const placeholders = deleteIds.map(() => '?').join(',')

            await transactionRepository.dataSource.execute(
              `DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
              deleteIds,
              {transaction: tx},
            )
          }

          // 2. OPERACIÓN BATCH: Actualizaciones (en paralelo)
          if (toUpdate.length > 0) {
            const tableName = this.getTableName(detailsRelationName)
            const updatePromises = toUpdate.map(det =>
              transactionRepository.dataSource.execute(
                `UPDATE ${tableName} SET weight_kg = ?, productId = ?, personId = ? WHERE id = ?`,
                [det.weight_kg, det.productId, det.personId, det.id],
                {transaction: tx},
              ),
            )
            await Promise.all(updatePromises)
          }

          // 3. OPERACIÓN BATCH: Creaciones (en paralelo usando ORM para seguridad)
          if (toCreate.length > 0) {
            const detailsRelation = this.getRelationAccessor(
              transactionRepository,
              detailsRelationName,
              transactionData.id,
            )

            const createPromises = toCreate.map(det =>
              detailsRelation.create(
                {
                  weight_kg: det.weight_kg!,
                  productId: det.productId!,
                  personId: det.personId!,
                },
                {transaction: tx},
              ),
            )
            await Promise.all(createPromises)
          } // 4. CÁLCULO OPTIMIZADO: Una sola query SQL para total (más eficiente)
          let newTotalKg = 0
          if (details.length > 0) {
            const tableName = this.getTableName(detailsRelationName)
            const parentIdField = this.getParentIdField(detailsRelationName)

            const totalResult = await transactionRepository.dataSource.execute(
              `SELECT COALESCE(SUM(weight_kg), 0) as total FROM ${tableName} WHERE ${parentIdField} = ?`,
              [transactionData.id],
              {transaction: tx},
            )
            newTotalKg = this.extractTotalKg(totalResult)
          }

          // 5. Actualizar transacción principal
          const {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            details: _details,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            id: _id,
            ...cleanTransactionData
          } = transactionData
          const updatePayload = {
            ...cleanTransactionData,
            total_kg: newTotalKg,
          } as Partial<T>

          await transactionRepository.updateById(
            transactionData.id,
            updatePayload,
            {
              transaction: tx,
            },
          )

          // 6. Retornar resultado con relaciones
          return transactionRepository.findById(
            transactionData.id,
            {
              include: [detailsRelationName],
            },
            {transaction: tx},
          )
        },
      )

      return result
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error updating transaction with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Validar detalles para operaciones de actualización
   */
  private validateDetailsForUpdate(
    details: Array<{
      id?: number
      weight_kg?: number
      productId?: number
      personId?: number
      toCreate?: boolean
      toUpdate?: boolean
      toDelete?: boolean
    }>,
  ): void {
    for (const det of details) {
      if ((det.toUpdate ?? false) || (det.toCreate ?? false)) {
        if (det.productId == null || det.personId == null) {
          throw new HttpErrors.BadRequest(
            'Product ID and Person ID are required for create/update operations',
          )
        }
        if (det.weight_kg == null || det.weight_kg <= 0) {
          throw new HttpErrors.BadRequest(
            'Weight must be a positive number for create/update operations',
          )
        }
      }
      if (det.toDelete && !det.id) {
        throw new HttpErrors.BadRequest(
          'Detail ID is required for delete operations',
        )
      }
      if (det.toUpdate && !det.id) {
        throw new HttpErrors.BadRequest(
          'Detail ID is required for update operations',
        )
      }
    }
  }

  /**
   * Obtener nombre de tabla desde nombre de relación
   */
  private getTableName(relationName: string): string {
    return this.getRelationConfig(relationName).tableName
  }

  /**
   * Obtener campo de ID padre desde nombre de relación
   */
  private getParentIdField(relationName: string): string {
    return this.getRelationConfig(relationName).parentIdField
  }

  private getRelationConfig(relationName: string): DetailRelationConfig {
    const config = DETAIL_RELATION_CONFIG[relationName]
    if (!config) {
      throw new HttpErrors.BadRequest(
        `Unsupported details relation: ${relationName}`,
      )
    }

    return config
  }

  public validateDate(date: string): void {
    const inputDate = new Date(date)
    if (isNaN(inputDate.getTime())) {
      throw new HttpErrors.BadRequest('Invalid date format.')
    }

    const year = inputDate.getFullYear()
    const currentYear = new Date().getFullYear()
    if (year < 2000 || year > currentYear) {
      throw new HttpErrors.BadRequest(
        `Invalid date. Year must be between 2000 and ${currentYear}.`,
      )
    }
  }

  private calculateTotalWeight(details?: Array<{weight_kg: number}>): number {
    return (
      details?.reduce((sum, detail) => sum + (detail.weight_kg ?? 0), 0) ?? 0
    )
  }

  private extractTotalKg(totalResult: unknown): number {
    if (!Array.isArray(totalResult) || totalResult.length === 0) {
      return 0
    }

    const firstRow = totalResult[0] as {total?: unknown}
    const total = Number(firstRow.total ?? 0)
    return Number.isFinite(total) ? total : 0
  }

  private validateDetailForCreate(detail: Partial<DetailBase>): void {
    if (detail.productId == null || detail.personId == null) {
      throw new HttpErrors.BadRequest(
        'Product ID and Person ID are required for create operations',
      )
    }

    if (detail.weight_kg == null || detail.weight_kg <= 0) {
      throw new HttpErrors.BadRequest(
        'Weight must be a positive number for create operations',
      )
    }
  }

  private async runInTransaction<T>(
    dataSource: DataSourceWithTransactions,
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    if (typeof dataSource.transaction !== 'function') {
      throw new HttpErrors.InternalServerError(
        'DataSource does not support transactions',
      )
    }

    return dataSource.transaction(work)
  }

  private getRelationAccessor<
    TEntity extends {id?: number},
    TDetail extends DetailBase,
  >(
    transactionRepository: TransactionRepository<TEntity>,
    detailsRelationName: string,
    parentId: number,
  ): RelationAccessor<TDetail> {
    const relationFactory = (transactionRepository as Record<string, unknown>)[
      detailsRelationName
    ] as RelationFactory<TDetail> | undefined

    if (typeof relationFactory !== 'function') {
      throw new HttpErrors.BadRequest(
        `Invalid details relation: ${detailsRelationName}`,
      )
    }

    return relationFactory(parentId)
  }

  private getStockOperator(
    isPurchase: boolean,
    mode: StockMutationMode,
  ): '+' | '-' {
    if (mode === 'apply') {
      return isPurchase ? '+' : '-'
    }

    return isPurchase ? '-' : '+'
  }

  private async executeStockUpdate(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    isPurchase: boolean,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    await dataSource.execute(
      `UPDATE product SET stock = COALESCE(stock, 0) ${operator} $1 WHERE id = $2`,
      [weightKg, productId],
      {transaction: tx},
    )

    await this.recordKardexMovement(
      dataSource,
      productId,
      weightKg,
      operator,
      isPurchase,
      mode,
      tx,
    )
  }

  private async adjustStock(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    isPurchase: boolean,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    const operator = this.getStockOperator(isPurchase, mode)
    await this.executeStockUpdate(
      dataSource,
      productId,
      weightKg,
      operator,
      isPurchase,
      mode,
      tx,
    )
  }

  private getKardexOperation(
    isPurchase: boolean,
    mode: StockMutationMode,
  ): number {
    if (isPurchase && mode === 'apply') return 1
    if (isPurchase && mode === 'undo') return 2
    if (!isPurchase && mode === 'apply') return 3
    return 4
  }

  private extractProductStock(stockResult: unknown): number {
    if (!Array.isArray(stockResult) || stockResult.length === 0) {
      return 0
    }

    const firstRow = stockResult[0] as {stock?: unknown}
    const stock = Number(firstRow.stock ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  private async recordKardexMovement(
    dataSource: DataSourceWithTransactions,
    productId: number,
    weightKg: number,
    operator: '+' | '-',
    isPurchase: boolean,
    mode: StockMutationMode,
    tx: TransactionContext,
  ): Promise<void> {
    const input = operator === '+' ? weightKg : 0
    const output = operator === '-' ? weightKg : 0

    const stockResult = await dataSource.execute(
      'SELECT COALESCE(stock, 0) as stock FROM product WHERE id = $1',
      [productId],
      {transaction: tx},
    )

    const balance = this.extractProductStock(stockResult)

    await this.kardexRepository.create(
      {
        date: new Date().toISOString(),
        input,
        output,
        balance,
        balance_record: true,
        operation: this.getKardexOperation(isPurchase, mode),
        productId,
      },
      {transaction: tx} as object,
    )
  }

  /**
   * Elimina una transacción y sus detalles, actualizando el stock de los productos.
   */
  async deleteWithDetails(
    id: number,
    transactionRepository: TransactionRepository<{id?: number}>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<void> {
    try {
      await this.runInTransaction(
        transactionRepository.dataSource,
        async (tx: TransactionContext) => {
          // 1. Obtener los detalles usando el ORM
          const detailsRelation = this.getRelationAccessor(
            transactionRepository,
            detailsRelationName,
            id,
          )
          const details = await detailsRelation.find({}, {transaction: tx})

          // 2. Restaurar el stock por cada detalle
          if (details && details.length > 0) {
            const detailPromises = details.map(detail =>
              this.adjustStock(
                transactionRepository.dataSource,
                detail.productId,
                detail.weight_kg,
                isPurchase,
                'undo',
                tx,
              ),
            )
            await Promise.all(detailPromises)
          }

          // 3. Borrar los detalles usando relación
          await detailsRelation.delete({}, {transaction: tx})

          // 4. Borrar transacción principal
          await transactionRepository.deleteById(id, {transaction: tx})
        },
      )
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error deleting transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Actualiza un único detalle, ajustando el stock según la diferencia y el tipo (compra/gasto).
   * Solo actualiza el stock si weight_kg o productId han cambiado.
   */
  async updateSingleDetail<TDetail extends DetailBase>(
    id: number,
    updatedDetail: Partial<TDetail>,
    detailsRepository: DetailRepository<TDetail>,
    isPurchase: boolean,
  ): Promise<TDetail> {
    try {
      return await this.runInTransaction(
        detailsRepository.dataSource,
        async (tx: TransactionContext) => {
          const oldDetail = await detailsRepository.findById(
            id,
            {},
            {transaction: tx},
          )

          let stockUpdatePromise: Promise<unknown> = Promise.resolve()

          // Si cambia el peso o el producto, hay que impactar en el inventario.
          // Asume que si manda weight_kg, pero es igual, al restarlos da 0.
          // Si cambia el producto: deshacer el inventario del producto anterior, y aplicar todo al nuevo.
          const newWeight = updatedDetail.weight_kg ?? oldDetail.weight_kg
          const oldWeight = oldDetail.weight_kg
          const newProductId = updatedDetail.productId ?? oldDetail.productId
          const oldProductId = oldDetail.productId

          if (newWeight !== oldWeight || newProductId !== oldProductId) {
            if (newProductId === oldProductId) {
              // Mismo producto, solo cambia la cantidad
              const diff = newWeight - oldWeight
              if (diff !== 0) {
                // diff > 0: creció → sumar si es compra, restar si es gasto
                // diff < 0: bajó  → restar si es compra, sumar si es gasto
                stockUpdatePromise = this.adjustStock(
                  detailsRepository.dataSource,
                  newProductId,
                  Math.abs(diff),
                  isPurchase,
                  diff > 0 ? 'apply' : 'undo',
                  tx,
                )
              }
            } else {
              // Producto diferente:
              // 1. Deshacer el viejo producto
              stockUpdatePromise = this.adjustStock(
                detailsRepository.dataSource,
                oldProductId,
                oldWeight,
                isPurchase,
                'undo',
                tx,
              ).then(() => {
                // 2. Aplicar al nuevo producto
                return this.adjustStock(
                  detailsRepository.dataSource,
                  newProductId,
                  newWeight,
                  isPurchase,
                  'apply',
                  tx,
                )
              })
            }
          }

          await stockUpdatePromise

          await detailsRepository.updateById(id, updatedDetail, {
            transaction: tx,
          })
          return detailsRepository.findById(
            id,
            {include: []},
            {transaction: tx},
          )
        },
      )
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error updating detail: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Elimina un único detalle y devuelve al inventario.
   */
  async deleteSingleDetail<TDetail extends DetailBase>(
    id: number,
    detailsRepository: DetailRepository<TDetail>,
    isPurchase: boolean,
  ): Promise<void> {
    try {
      await this.runInTransaction(
        detailsRepository.dataSource,
        async (tx: TransactionContext) => {
          const detail = await detailsRepository.findById(
            id,
            {},
            {transaction: tx},
          )
          await this.adjustStock(
            detailsRepository.dataSource,
            detail.productId,
            detail.weight_kg,
            isPurchase,
            'undo',
            tx,
          )

          await detailsRepository.deleteById(id, {transaction: tx})
        },
      )
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error deleting detail: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Crea un único detalle y actualiza el inventario directamente
   */
  async createSingleDetail<
    TParent extends {id?: number},
    TDetail extends DetailBase,
  >(
    parentId: number,
    newDetail: Partial<TDetail>,
    parentRepository: TransactionRepository<TParent>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<TDetail> {
    try {
      this.validateDetailForCreate(newDetail)

      return await this.runInTransaction(
        parentRepository.dataSource,
        async (tx: TransactionContext) => {
          const detailsRelation = this.getRelationAccessor<TParent, TDetail>(
            parentRepository,
            detailsRelationName,
            parentId,
          )

          // Crear detalle usando la relación (eso asocia el parentId automáticamente)
          const detail = await detailsRelation.create(newDetail, {
            transaction: tx,
          })

          // Impactar al inventario
          await this.adjustStock(
            parentRepository.dataSource,
            detail.productId,
            detail.weight_kg,
            isPurchase,
            'apply',
            tx,
          )

          return detail
        },
      )
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Error creating detail: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}
