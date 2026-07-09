import { ForeignDetailError } from '../../errors'

export type DetailDiff<
  D extends {
    id?: number
    weight_kg: number
    productId: number
    personId: number
  },
> = {
  toCreate: D[]
  toUpdate: Array<{ old: D; new: D }>
  toDelete: D[]
}

/**
 * Computes which details to create, update, or delete by comparing
 * the existing DB state against the incoming payload.
 *
 * Pure function: throws the domain-level ForeignDetailError (not an
 * HttpError) if an incoming id does not belong to the parent. The service
 * layer translates it to a 403.
 */
export function computeDetailsDiff<
  D extends {
    id?: number
    weight_kg: number
    productId: number
    personId: number
  },
>(existingDetails: D[], incomingDetails: D[]): DetailDiff<D> {
  const existingMap = new Map(existingDetails.map(d => [d.id, d]))
  const toCreate: D[] = []
  const toUpdate: Array<{ old: D; new: D }> = []
  const incomingIds = new Set<number>()

  for (const det of incomingDetails) {
    if (!det.id || det.id <= 0) {
      toCreate.push(det)
    } else {
      if (!existingMap.has(det.id)) {
        throw new ForeignDetailError(det.id)
      }
      incomingIds.add(det.id)
      const existing = existingMap.get(det.id)!
      if (
        existing.weight_kg !== det.weight_kg ||
        existing.productId !== det.productId ||
        existing.personId !== det.personId
      ) {
        toUpdate.push({ old: existing, new: det })
      }
    }
  }

  const toDelete = existingDetails.filter(d => d.id && !incomingIds.has(d.id))

  return { toCreate, toUpdate, toDelete }
}
