import {Entity, hasMany, model, property} from '@loopback/repository';
import {Person} from './person.model';
import {Product} from './product.model';
import {PurchaseDetails} from './purchase-details.model';

@model()
export class Purchase extends Entity {
  @property({
    type: 'number',
    id: true,
    generated: true,
  })
  id?: number;

  @property({
    type: 'date',
    jsonSchema: {
      format: 'date',
    },
    required: true,
    mysql: {
      columnName: 'date',
      dataType: 'date',
      dataLength: null,
      dataPrecision: null,
      dataScale: null,
      nullable: 'N',
    },
  })
  date: string;


  @property({
    type: 'number',
  })
  total_kg?: number;

  @hasMany(() => PurchaseDetails)
  purchase_details?: PurchaseDetails[];

  @hasMany(() => Person, {through: {model: () => PurchaseDetails}})
  people: Person[];

  @hasMany(() => Product, {through: {model: () => PurchaseDetails}})
  products: Product[];

  constructor(data?: Partial<Purchase>) {
    super(data);
  }
}

export interface PurchaseRelations {
  // describe navigational properties here
}

export type PurchaseWithRelations = Purchase & PurchaseRelations;
