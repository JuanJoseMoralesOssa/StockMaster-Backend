import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { Kardex, PaymentDetails, Person, PurchaseDetails } from '../models'
import {
  PaymentDetailsRepository,
  PurchaseDetailsRepository,
} from '../repositories'

/**
 * A Kardex row as the UI consumes it: the persisted movement plus the supplier
 * it can be traced back to. Deliberately a plain object and NOT a `Kardex`
 * instance — `supplierName` is not a column, and pretending otherwise is what
 * forced the controller into `as unknown as Kardex[]` casts that lied about the
 * shape to every reader downstream.
 */
export type KardexWithSupplier = Record<string, unknown> & {
  supplierName?: string
}

/** Which document table a Kardex row's provenance points at. */
type SourceKind = 'purchase' | 'payment'

type DetailWithPerson = (PurchaseDetails | PaymentDetails) & { person?: Person }

/**
 * Read-side enrichment of Kardex rows. The Kardex has no person relation — its
 * provenance is `sourceKind` + `sourceDetailId` — so the supplier has to be
 * resolved by following that pointer into the right detail table. That is domain
 * work, not HTTP work, so it lives here and the controller just serves what it
 * returns.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class KardexQueryService {
  constructor(
    @repository(PurchaseDetailsRepository)
    private readonly purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(PaymentDetailsRepository)
    private readonly paymentDetailsRepository: PaymentDetailsRepository,
  ) {}

  /**
   * Attaches the supplier name to each row. The detail lookups are BATCHED —
   * one query per source kind with an `inq` over the ids — so a page of N rows
   * costs two queries, not N. Rows with no source (manual adjustments, opening
   * balances) simply come back without a supplier; that is a legitimate state,
   * not a missing lookup.
   */
  async withSuppliers(kardexes: Kardex[]): Promise<KardexWithSupplier[]> {
    const [purchaseDetails, paymentDetails] = await Promise.all([
      this.findDetailsByIds(
        'purchase',
        this.sourceDetailIds(kardexes, 'purchase'),
      ),
      this.findDetailsByIds(
        'payment',
        this.sourceDetailIds(kardexes, 'payment'),
      ),
    ])

    const supplierBySource = new Map<string, string>()
    this.indexSuppliers(supplierBySource, 'purchase', purchaseDetails)
    this.indexSuppliers(supplierBySource, 'payment', paymentDetails)

    return kardexes.map(kardex => ({
      ...(kardex.toJSON() as Record<string, unknown>),
      supplierName: supplierBySource.get(this.sourceKey(kardex)),
    }))
  }

  /** Unique detail ids this page points at for one source kind. */
  private sourceDetailIds(kardexes: Kardex[], kind: SourceKind): number[] {
    return [
      ...new Set(
        kardexes
          .filter(k => k.sourceKind === kind && k.sourceDetailId != null)
          .map(k => k.sourceDetailId as number),
      ),
    ]
  }

  private async findDetailsByIds(
    kind: SourceKind,
    ids: number[],
  ): Promise<DetailWithPerson[]> {
    if (ids.length === 0) return []

    const repo =
      kind === 'purchase'
        ? this.purchaseDetailsRepository
        : this.paymentDetailsRepository

    const details = await repo.find({
      where: { id: { inq: ids } },
      include: [{ relation: 'person' }],
    })
    return details as DetailWithPerson[]
  }

  private indexSuppliers(
    supplierBySource: Map<string, string>,
    kind: SourceKind,
    details: DetailWithPerson[],
  ): void {
    for (const detail of details) {
      if (detail.id != null && detail.person?.name) {
        supplierBySource.set(`${kind}:${detail.id}`, detail.person.name)
      }
    }
  }

  /** Keyed by kind AND id: detail ids are only unique within their own table. */
  private sourceKey(kardex: Kardex): string {
    return `${kardex.sourceKind}:${kardex.sourceDetailId}`
  }
}
