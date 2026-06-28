import { normalizePagination } from '../config/pagination'

export type DocumentFilterParams = {
  startDate?: string
  endDate?: string
  personId?: number
  productId?: number
  page?: number
  limit?: number
}

type FilterableRepo<T> = {
  find(filter?: object): Promise<T[]>
  count(where?: object): Promise<{ count: number }>
}

/**
 * Shared filtering logic for paginated document queries (payment / purchase).
 *
 * @param parentRepo  - the WithTotal repository (has .find, .count)
 * @param detailRelationName  - e.g. 'payment_details' or 'purchase_details'
 * @param getMatchingParentIds  - resolves the parent IDs that match person/product filters
 * @param params  - filter/pagination query params
 */
export async function findFilteredDocuments<
  TParent extends { id?: number; date?: string },
>(
  parentRepo: FilterableRepo<TParent>,
  detailRelationName: string,
  getMatchingParentIds: (
    detailWhere: Record<string, unknown>,
  ) => Promise<number[] | undefined>,
  params: DocumentFilterParams,
): Promise<{ data: TParent[]; count: number }> {
  const { startDate, endDate, personId, productId, page, limit } = params

  const detailWhere: Record<string, unknown> = {}
  if (personId !== undefined) detailWhere.personId = personId
  if (productId !== undefined) detailWhere.productId = productId

  let parentIds: number[] | undefined

  if (Object.keys(detailWhere).length > 0) {
    const ids = await getMatchingParentIds(detailWhere)
    if (ids !== undefined) {
      if (ids.length === 0) return { data: [], count: 0 }
      parentIds = ids
    }
  }

  const where: Record<string, unknown> = {}

  if (startDate && endDate) {
    where.date = { between: [startDate, endDate] }
  } else if (startDate) {
    where.date = { gte: startDate }
  } else if (endDate) {
    where.date = { lte: endDate }
  }

  if (parentIds) {
    where.id = { inq: parentIds }
  }

  const includeScope: Record<string, unknown> = {}
  if (Object.keys(detailWhere).length > 0) {
    includeScope.where = detailWhere
  }

  const pagination = normalizePagination(page, limit)

  const [data, countResult] = await Promise.all([
    parentRepo.find({
      where,
      include: [
        {
          relation: detailRelationName,
          ...(Object.keys(includeScope).length > 0
            ? { scope: includeScope }
            : {}),
        },
      ],
      order: ['date DESC'],
      skip: pagination.skip,
      limit: pagination.limit,
    }),
    parentRepo.count(where),
  ])

  return { data, count: countResult.count }
}
