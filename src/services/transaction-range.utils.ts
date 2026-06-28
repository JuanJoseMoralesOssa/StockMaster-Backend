/**
 * Shared "which purchase/payment documents fall in this date range" lookup.
 * Both the analytics dashboard and the detail reports prefetch parent ids and
 * then query details with an `inq` — this is the single home for that step.
 */
export type ParentRepoLike = {
  find(filter?: object): Promise<Array<{ id?: number }>>
}

export function dateBetweenFilter(
  startDate: string,
  endDate: string,
): { between: [string, string] } {
  return { between: [startDate, endDate] }
}

export async function findParentIdsInRange(
  repo: ParentRepoLike,
  startDate: string,
  endDate: string,
): Promise<number[]> {
  const parents = await repo.find({
    where: { date: dateBetweenFilter(startDate, endDate) },
    fields: ['id'],
  })
  return parents.map(p => p.id).filter((id): id is number => id != null)
}
