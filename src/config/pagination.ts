export const paginationConfig = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
}

export type NormalizedPagination = {
  page: number
  limit: number
  skip: number
}

export function normalizeLimit(
  limit: number = paginationConfig.DEFAULT_LIMIT,
): number {
  const requestedLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : paginationConfig.DEFAULT_LIMIT

  return Math.min(requestedLimit, paginationConfig.MAX_LIMIT)
}

export function normalizePagination(
  page: number = paginationConfig.DEFAULT_PAGE,
  limit: number = paginationConfig.DEFAULT_LIMIT,
): NormalizedPagination {
  const normalizedPage =
    Number.isFinite(page) && page > 0
      ? Math.floor(page)
      : paginationConfig.DEFAULT_PAGE
  const normalizedLimit = normalizeLimit(limit)

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  }
}
