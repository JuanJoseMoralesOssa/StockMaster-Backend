/**
 * Mensajes de error visibles para el usuario final. Todos en español, en un
 * solo lugar, para que el idioma y el tono no se desvíen entre capas
 * (servicios, helpers SQL e interceptor de errores).
 */
export const USER_MESSAGES = {
  // Concurrencia / bloqueo optimista
  CONFLICT_MODIFIED:
    'Este registro fue modificado por otro usuario. Por favor recarga y vuelve a intentarlo.',
  RETRYABLE_CONFLICT:
    'La operación no pudo completarse por un conflicto temporal de concurrencia. Inténtalo de nuevo.',

  // Restricciones de la base de datos
  INSUFFICIENT_STOCK: 'Stock insuficiente para completar la operación.',
  DATA_CONSTRAINT: 'La operación viola una restricción de datos.',
  RELATED_RECORDS:
    'La operación no puede completarse porque existen registros relacionados.',
  DUPLICATE_RECORD: 'Ya existe un registro con esos datos únicos.',

  // Validación de transacciones y detalles
  AT_LEAST_ONE_DETAIL: 'La transacción debe tener al menos un detalle.',
  DETAIL_FIELDS_REQUIRED:
    'Cada detalle requiere un producto y una persona válidos.',
  WEIGHT_POSITIVE: 'El peso debe ser un número positivo.',
  DETAIL_MOVE_FORBIDDEN: 'No se permite mover un detalle a otra transacción.',
  TRANSACTION_ID_REQUIRED:
    'El ID de la transacción es obligatorio para actualizarla.',

  // Validación de fechas y rangos
  DATE_INVALID_FORMAT: 'Formato de fecha inválido. Usa AAAA-MM-DD.',
  DATE_RANGE_REQUIRED: 'startDate y endDate son obligatorios.',
  DATE_RANGE_ORDER: 'startDate debe ser anterior o igual a endDate.',

  UNEXPECTED: 'Ocurrió un error inesperado. Por favor contacta a soporte.',
} as const

export function invalidDateYearMessage(currentYear: number): string {
  return `Fecha inválida. El año debe estar entre 2000 y ${currentYear}.`
}

export function invalidDateFormatMessage(label: string): string {
  return `Formato de ${label} inválido. Usa AAAA-MM-DD.`
}

export function invalidDateValueMessage(label: string): string {
  return `Valor de ${label} inválido.`
}

export function dateRangeTooLargeMessage(maxDays: number): string {
  return `El rango de fechas no puede superar ${maxDays} días.`
}

export function versionRequiredMessage(paramName: string): string {
  return `El parámetro ${paramName} es obligatorio y debe ser un número positivo.`
}

export function fieldRequiredMessage(fieldName: string): string {
  return `El campo ${fieldName} es obligatorio.`
}

export function foreignDetailMessage(detailId: number): string {
  return `El detalle con ID ${detailId} no pertenece a esta transacción.`
}

export function notFoundMessage(entity: string, id: number): string {
  return `${entity} con id ${id} no encontrado.`
}

export function productStockNotFoundMessage(productId: number): string {
  return `No se puede conciliar el stock: el producto ${productId} no existe.`
}
