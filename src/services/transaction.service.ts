import { /* inject, */ BindingScope, injectable, service } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { StockReconciliationService } from './stock-reconciliation.service'

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

type TransactionRepository<TEntity extends { id?: number } = { id?: number }> =
  {
    dataSource: DataSourceWithTransactions
    create(
      data: Partial<TEntity>,
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

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionService {
  constructor(
    @service(StockReconciliationService)
    private readonly stockReconciliationService: StockReconciliationService,
  ) {}

  /**
   * Lógica compartida para crear transacción con detalles
   */
  async createWithDetails<
    T extends { id?: number; date: string },
    D extends { weight_kg: number; productId: number; personId: number },
  >(
    transactionData: Partial<T> & { details?: D[] },
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<T> {
    // Validar fecha
    this.validateDate(transactionData.date!)

    if (!transactionData.details || transactionData.details.length === 0) {
      throw new HttpErrors.BadRequest(
        'A transaction must have at least one detail.',
      )
    }

    try {
      // Usar transacción real para garantizar atomicidad e incluir stock
      const result = await this.runInTransaction(
        transactionRepository.dataSource,
        async (tx: TransactionContext) => {
          // Extraer los detalles y crear un objeto limpio para el modelo principal
          const { details, ...cleanTransactionData } = transactionData
          const createPayload = {
            ...cleanTransactionData,
          } as Partial<T>

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
                { transaction: tx },
              )

              // 2. Actualizar el stock del producto de forma síncrona/atómica
              await this.stockReconciliationService.adjustStock(
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
            { transaction: tx },
          )
        },
      )

      return result
    } catch (error) {
      if (error && (error as { statusCode?: number }).statusCode) {
        throw error
      }
      throw new HttpErrors.BadRequest(
        `Error creating transaction with details: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Actualiza una transacción con sus detalles (crear, actualizar, eliminar detalles)
   * Versión optimizada con transacciones reales, control concurrente optimista y auto-reconciliación
   */
  async updateWithDetails<
    T extends {
      id?: number
      date?: string
      version?: number
    },
    D extends {
      id?: number
      weight_kg: number
      productId: number
      personId: number
    },
  >(
    transactionData: Partial<Omit<T, 'id'>> & {
      id: number
      version?: number
      details?: D[]
    },
    transactionRepository: TransactionRepository<T>,
    detailsRelationName: string,
    isPurchase: boolean,
  ): Promise<T> {
    if (!transactionData.id) {
      throw new HttpErrors.BadRequest('Transaction ID is required for update')
    }

    if (transactionData.version === undefined) {
      throw new HttpErrors.Conflict(
        'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
      )
    }

    // Validar fecha si está presente
    if (transactionData.date) {
      this.validateDate(transactionData.date)
    }

    try {
      const details = transactionData.details ?? []

      if (details.length === 0) {
        throw new HttpErrors.BadRequest(
          'A transaction must have at least one detail.',
        )
      }

      // Validar datos básicos
      this.validateDetailsForUpdate(details)

      // Usar transacción real para garantizar atomicidad e incluir stock
      const result = await this.runInTransaction(
        transactionRepository.dataSource,
        async (tx: TransactionContext) => {
          // 1. Validar Versión Concurrente (Optimistic Concurrency Control)
          const currentTransaction = await transactionRepository.findById(
            transactionData.id,
            {},
            { transaction: tx },
          )

          if (currentTransaction.version !== transactionData.version) {
            throw new HttpErrors.Conflict(
              'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
            )
          }

          // 2. Obtener detalles actuales desde la DB
          const detailsRelation = this.getRelationAccessor<T, D>(
            transactionRepository,
            detailsRelationName,
            transactionData.id,
          )
          const existingDetails = await detailsRelation.find(
            {},
            { transaction: tx },
          )
          const existingMap = new Map(existingDetails.map(d => [d.id, d]))

          // 3. Ownership Validation: Asegurar que IDs enviados pertenezcan al parent
          for (const det of details) {
            if (det.id && det.id > 0 && !existingMap.has(det.id)) {
              throw new HttpErrors.Forbidden(
                `El detalle con ID ${det.id} no pertenece a esta transacción.`,
              )
            }
          }

          // 4. Determinar Array Diffing
          const toCreate: D[] = []
          const toUpdate: { old: D; new: D }[] = []
          const incomingIds = new Set<number>()

          for (const det of details) {
            if (!det.id || det.id <= 0) {
              toCreate.push(det)
            } else {
              incomingIds.add(det.id)
              const existing = existingMap.get(det.id)
              if (existing) {
                // Verificar si hay cambios reales en los campos clave
                if (
                  existing.weight_kg !== det.weight_kg ||
                  existing.productId !== det.productId ||
                  existing.personId !== det.personId
                ) {
                  toUpdate.push({ old: existing, new: det })
                }
              }
            }
          }

          const toDelete = existingDetails.filter(
            d => d.id && !incomingIds.has(d.id),
          )

          // 5. OPERACIÓN: Eliminaciones (Restaurar stock y borrar detalle)
          if (toDelete.length > 0) {
            const deletePromises = toDelete.map(async oldDet => {
              // Restaurar stock deshaciendo la operación anterior
              await this.stockReconciliationService.adjustStock(
                transactionRepository.dataSource,
                oldDet.productId,
                oldDet.weight_kg,
                isPurchase,
                'undo',
                tx,
              )
            })
            await Promise.all(deletePromises)

            // Borrar de DB
            const deleteIds = toDelete.map(d => d.id!)
            const tableName = this.getTableName(detailsRelationName)
            const placeholders = deleteIds.map((_, i) => `$${i + 1}`).join(',')

            await transactionRepository.dataSource.execute(
              `DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
              deleteIds,
              { transaction: tx },
            )
          }

          // 6. OPERACIÓN: Actualizaciones (Calcular delta de stock y actualizar DB)
          if (toUpdate.length > 0) {
            const tableName = this.getTableName(detailsRelationName)
            const updatePromises = toUpdate.map(async ({ old, new: det }) => {
              // Si cambia de producto
              if (old.productId !== det.productId) {
                // Deshacer el viejo
                await this.stockReconciliationService.adjustStock(
                  transactionRepository.dataSource,
                  old.productId,
                  old.weight_kg,
                  isPurchase,
                  'undo',
                  tx,
                )
                // Aplicar el nuevo
                await this.stockReconciliationService.adjustStock(
                  transactionRepository.dataSource,
                  det.productId,
                  det.weight_kg,
                  isPurchase,
                  'apply',
                  tx,
                )
              } else {
                // Solo cambia el peso
                const diff = det.weight_kg - old.weight_kg
                if (diff !== 0) {
                  await this.stockReconciliationService.adjustStock(
                    transactionRepository.dataSource,
                    det.productId,
                    Math.abs(diff),
                    isPurchase,
                    diff > 0 ? 'apply' : 'undo',
                    tx,
                  )
                }
              }

              return transactionRepository.dataSource.execute(
                `UPDATE ${tableName} SET weight_kg = $1, productId = $2, personId = $3 WHERE id = $4`,
                [det.weight_kg, det.productId, det.personId, det.id],
                { transaction: tx },
              )
            })
            await Promise.all(updatePromises)
          }

          // 7. OPERACIÓN: Creaciones
          if (toCreate.length > 0) {
            const createPromises = toCreate.map(async det => {
              await detailsRelation.create(
                {
                  weight_kg: det.weight_kg,
                  productId: det.productId,
                  personId: det.personId,
                } as Partial<D>,
                { transaction: tx },
              )

              await this.stockReconciliationService.adjustStock(
                transactionRepository.dataSource,
                det.productId,
                det.weight_kg,
                isPurchase,
                'apply',
                tx,
              )
            })
            await Promise.all(createPromises)
          }

          // 8. Actualizar transacción principal e incrementar version (Idempotente)
          const cleanTransactionData: Record<string, unknown> = {
            ...transactionData,
          }
          delete cleanTransactionData.details
          delete cleanTransactionData.id
          delete cleanTransactionData.version

          const hasMutations =
            toCreate.length > 0 || toUpdate.length > 0 || toDelete.length > 0
          const currentVersion = currentTransaction.version ?? 1
          const newVersion = hasMutations ? currentVersion + 1 : currentVersion

          const updatePayload = {
            ...cleanTransactionData,
            version: newVersion,
          } as Partial<T>

          await transactionRepository.updateById(
            transactionData.id,
            updatePayload,
            {
              transaction: tx,
            },
          )

          // 10. Retornar resultado con relaciones (Aggregate actualizado)
          return transactionRepository.findById(
            transactionData.id,
            {
              include: [detailsRelationName],
            },
            { transaction: tx },
          )
        },
      )

      return result
    } catch (error) {
      if (error && (error as { statusCode?: number }).statusCode) {
        throw error
      }
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
      weight_kg: number
      productId: number
      personId: number
    }>,
  ): void {
    for (const det of details) {
      if (det.productId == null || det.personId == null) {
        throw new HttpErrors.BadRequest(
          'Product ID and Person ID are required for detail operations',
        )
      }
      if (det.weight_kg == null || det.weight_kg <= 0) {
        throw new HttpErrors.BadRequest(
          'Weight must be a positive number for detail operations',
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

    let result: T | undefined
    await dataSource.transaction(async tx => {
      result = await work(tx)
    })
    return result as T
  }

  private getRelationAccessor<
    TEntity extends { id?: number },
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

  /**
   * Elimina una transacción y sus detalles, actualizando el stock de los productos.
   */
  async deleteWithDetails(
    id: number,
    transactionRepository: TransactionRepository<{ id?: number }>,
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
          const details = await detailsRelation.find({}, { transaction: tx })

          // 2. Restaurar el stock por cada detalle
          if (details && details.length > 0) {
            const detailPromises = details.map(detail =>
              this.stockReconciliationService.adjustStock(
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
          await detailsRelation.delete({}, { transaction: tx })

          // 4. Borrar transacción principal
          await transactionRepository.deleteById(id, { transaction: tx })
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
            { transaction: tx },
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
                stockUpdatePromise =
                  this.stockReconciliationService.adjustStock(
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
              stockUpdatePromise = this.stockReconciliationService
                .adjustStock(
                  detailsRepository.dataSource,
                  oldProductId,
                  oldWeight,
                  isPurchase,
                  'undo',
                  tx,
                )
                .then(() => {
                  // 2. Aplicar al nuevo producto
                  return this.stockReconciliationService.adjustStock(
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
            { include: [] },
            { transaction: tx },
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
            { transaction: tx },
          )
          await this.stockReconciliationService.adjustStock(
            detailsRepository.dataSource,
            detail.productId,
            detail.weight_kg,
            isPurchase,
            'undo',
            tx,
          )

          await detailsRepository.deleteById(id, { transaction: tx })
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
    TParent extends { id?: number },
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
          await this.stockReconciliationService.adjustStock(
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
