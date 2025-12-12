import { /* inject, */ BindingScope, injectable } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'

@injectable({ scope: BindingScope.TRANSIENT })
export class TransactionService {
  constructor(/* Add @inject to inject parameters */) {}

  /**
   * Lógica compartida para crear transacción con detalles
   */
  async createWithDetails<
    T extends { date: string },
    D extends { weight_kg: number; productId: number; personId: number },
  >(
    transactionData: Partial<T> & { details?: D[] },
    repository: any,
    detailsRelationName: string,
  ): Promise<T> {
    // Validar fecha
    this.validateDate(transactionData.date!)

    // Calcular total_kg
    const totalKg = this.calculateTotalWeight(transactionData.details)

    try {
      // Extraer los detalles y crear un objeto limpio para el modelo principal
      const { details, ...cleanTransactionData } = transactionData

      // Crear transacción principal (sin la propiedad details)
      const transaction = await repository.create({
        ...cleanTransactionData,
        total_kg: totalKg,
      })

      // Crear detalles en paralelo para mejor performance
      if (details && details.length > 0) {
        const detailPromises = this.createDetails(
          { details },
          transaction,
          repository,
          detailsRelationName,
        )
        await Promise.all(detailPromises)
      }

      return repository.findById(transaction.id, {
        include: [detailsRelationName],
      })
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
    T extends { id: number; date?: string },
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
    transactionData: T & { details?: D[] },
    repository: any,
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
      const result = await repository.dataSource.transaction(
        async (tx: any) => {
          // 1. OPERACIÓN BATCH: Eliminaciones (más eficiente que individual)
          if (toDelete.length > 0) {
            const deleteIds = toDelete.map(d => d.id)
            const tableName = this.getTableName(detailsRelationName)
            const placeholders = deleteIds.map(() => '?').join(',')

            await repository.dataSource.execute(
              `DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
              deleteIds,
              { transaction: tx },
            )
          }

          // 2. OPERACIÓN BATCH: Actualizaciones (en paralelo)
          if (toUpdate.length > 0) {
            const tableName = this.getTableName(detailsRelationName)
            const updatePromises = toUpdate.map(det =>
              repository.dataSource.execute(
                `UPDATE ${tableName} SET weight_kg = ?, productId = ?, personId = ? WHERE id = ?`,
                [det.weight_kg, det.productId, det.personId, det.id],
                { transaction: tx },
              ),
            )
            await Promise.all(updatePromises)
          }

          // 3. OPERACIÓN BATCH: Creaciones (en paralelo usando ORM para seguridad)
          if (toCreate.length > 0) {
            const createPromises = toCreate.map(det =>
              repository[detailsRelationName](transactionData.id).create(
                {
                  weight_kg: det.weight_kg,
                  productId: det.productId,
                  personId: det.personId,
                },
                { transaction: tx },
              ),
            )
            await Promise.all(createPromises)
          } // 4. CÁLCULO OPTIMIZADO: Una sola query SQL para total (más eficiente)
          let newTotalKg = 0
          if (details.length > 0) {
            const tableName = this.getTableName(detailsRelationName)
            const parentIdField = this.getParentIdField(detailsRelationName)

            const totalResult = await repository.dataSource.execute(
              `SELECT COALESCE(SUM(weight_kg), 0) as total FROM ${tableName} WHERE ${parentIdField} = ?`,
              [transactionData.id],
              { transaction: tx },
            )
            newTotalKg = totalResult[0]?.total || 0
          }

          // 5. Actualizar transacción principal
          const {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            details: _details,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            id: _id,
            ...cleanTransactionData
          } = transactionData

          await repository.updateById(
            transactionData.id,
            {
              ...cleanTransactionData,
              total_kg: newTotalKg,
            },
            { transaction: tx },
          )

          // 6. Retornar resultado con relaciones
          return repository.findById(
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
        if (!det.productId || !det.personId) {
          throw new HttpErrors.BadRequest(
            'Product ID and Person ID are required for create/update operations',
          )
        }
        if (!det.weight_kg || det.weight_kg <= 0) {
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
    // Convertir expense_details -> expensedetails, purchase_details -> purchasedetails
    return relationName.replace('_', '')
  }

  /**
   * Obtener campo de ID padre desde nombre de relación
   */
  private getParentIdField(relationName: string): string {
    // Convertir expense_details -> expenseId, purchase_details -> purchaseId
    const parentName = relationName.replace('_details', '')
    return `${parentName}Id`
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

  private calculateTotalWeight(details?: Array<{ weight_kg: number }>): number {
    return (
      details?.reduce((sum, detail) => sum + (detail.weight_kg ?? 0), 0) ?? 0
    )
  }

  private createDetails(
    transactionData: {
      details?: Array<{
        weight_kg: number
        productId: number
        personId: number
      }>
    },
    transaction: { id: number },
    repository: any,
    detailsRelationName: string,
  ): Promise<any>[] {
    return (
      transactionData.details?.map(detail =>
        repository[detailsRelationName](transaction.id).create({
          weight_kg: detail.weight_kg,
          productId: detail.productId,
          personId: detail.personId,
        }),
      ) ?? []
    )
  }
}
