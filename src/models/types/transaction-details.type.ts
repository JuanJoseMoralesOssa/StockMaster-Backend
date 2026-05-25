export interface TransactionDetailPersonProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
}

export interface TransactionDetailProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
  personId: number // Opcional para incluir información del proveedor
  personName?: string // Opcional para mostrar el nombre del proveedor
}

export interface TransactionDetailPerson {
  date: string
  weight_kg: number
  type: 'Compra' | 'Gasto'
  productId: number // Opcional para incluir información del proveedor
  personName?: string // Opcional para mostrar el nombre del proveedor
}
