export interface TransactionDetailRequestDTO {
  id?: number
  weight_kg: number
  productId: number
  personId: number
}

export interface TransactionDetailPersonProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Pago'
}

export interface TransactionDetailProduct {
  date: string
  weight_kg: number
  type: 'Compra' | 'Pago'
  personId: number
  personName?: string
}

export interface TransactionDetailPerson {
  date: string
  weight_kg: number
  type: 'Compra' | 'Pago'
  productId: number
  personName?: string
}
