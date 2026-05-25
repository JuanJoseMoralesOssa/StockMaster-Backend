import { Model, model, property } from '@loopback/repository'

@model()
export class Pagination<T = unknown> extends Model {
  @property({
    type: 'number',
    required: true,
  })
  count: number

  @property({
    type: 'array',
    itemType: 'object',
    required: true,
  })
  data: T[]

  @property({
    type: 'number',
    required: false,
  })
  page?: number

  @property({
    type: 'number',
    required: false,
  })
  limit?: number

  @property({
    type: 'number',
    required: false,
  })
  totalPages?: number

  @property({
    type: 'boolean',
    required: false,
  })
  hasNext?: boolean

  @property({
    type: 'boolean',
    required: false,
  })
  hasPrevious?: boolean

  constructor(data?: Partial<Pagination<T>>) {
    super(data)
    this.count = data?.count ?? 0
    this.data = data?.data ?? []
    this.page = data?.page ?? 1
    this.limit = data?.limit ?? 10
    this.totalPages = this.limit ? Math.ceil(this.count / this.limit) : 1
    this.hasNext = data?.hasNext ?? this.page < this.totalPages
    this.hasPrevious = data?.hasPrevious ?? this.page > 1
  }
}

export interface PaginationRelations {
  // describe navigational properties here
}

export type PaginationWithRelations<T = unknown> = Pagination<T> &
  PaginationRelations

// Utility type for creating paginated responses
export interface PaginatedResponse<T> {
  count: number
  data: T[]
  page?: number
  limit?: number
  totalPages?: number
  hasNext?: boolean
  hasPrevious?: boolean
}
