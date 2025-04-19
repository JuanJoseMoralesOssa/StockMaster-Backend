import {Entity, model, property} from '@loopback/repository';

@model()
export class PurchaseDetails extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number;

  @property({
    type: 'number',
    required: true,
  })
  weight_kg: number;

  @property({
    type: 'number',
  })
  personId?: number;

  @property({
    type: 'number',
  })
  productId?: number;

  @property({
    type: 'number',
  })
  purchaseId?: number;

  constructor(data?: Partial<PurchaseDetails>) {
    super(data);
  }
}

export interface PurchaseDetailsRelations {
  // describe navigational properties here
}

export type PurchaseDetailsWithRelations = PurchaseDetails &
  PurchaseDetailsRelations;
