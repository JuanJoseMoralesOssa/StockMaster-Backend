import {repository} from '@loopback/repository';
import {get, HttpErrors, param} from '@loopback/rest';
import {
  ExpenseDetailsRepository,
  PersonRepository,
  ProductRepository,
  PurchaseDetailsRepository,
} from '../../../repositories';

interface SupplierAnalytics {
  personId: number;
  personName: string;
  totalWeight: number;
  transactionCount: number;
}

interface ProductAnalytics {
  productId: number;
  productName: string;
  totalWeight: number;
  transactionCount: number;
}

interface DateRangeAnalytics {
  topSuppliers: SupplierAnalytics[];
  bottomSuppliers: SupplierAnalytics[];
  topProducts: ProductAnalytics[];
  bottomProducts: ProductAnalytics[];
  summary: {
    totalSuppliers: number;
    totalProducts: number;
    totalWeight: number;
    totalTransactions: number;
  };
}

export class GeneralReportsController {
  constructor(
    @repository(PurchaseDetailsRepository)
    protected purchaseDetailsRepository: PurchaseDetailsRepository,
    @repository(ExpenseDetailsRepository)
    protected expenseDetailsRepository: ExpenseDetailsRepository,
    @repository(PersonRepository)
    protected personRepository: PersonRepository,
    @repository(ProductRepository)
    protected productRepository: ProductRepository,
  ) {}

  @get('/analytics/date-range')
  async getDateRangeAnalytics(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.string('type') type: 'purchases' | 'expenses' | 'both' = 'both',
  ): Promise<DateRangeAnalytics> {
    this.validateDateRange(startDate, endDate);

    const [supplierAnalytics, productAnalytics] = await Promise.all([
      this.getSupplierAnalytics(startDate, endDate, type),
      this.getProductAnalytics(startDate, endDate, type),
    ]);

    return {
      topSuppliers: this.getTopResults(supplierAnalytics, 'max'),
      bottomSuppliers: this.getTopResults(supplierAnalytics, 'min'),
      topProducts: this.getTopResults(productAnalytics, 'max'),
      bottomProducts: this.getTopResults(productAnalytics, 'min'),
      summary: this.calculateSummary(supplierAnalytics, productAnalytics),
    };
  }

  @get('/analytics/suppliers/top')
  async getTopSuppliers(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getSupplierAnalytics(startDate, endDate, 'both');
    return analytics.sort((a, b) => b.totalWeight - a.totalWeight).slice(0, limit);
  }

  @get('/analytics/products/top')
  async getTopProducts(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both');
    return analytics.sort((a, b) => b.totalWeight - a.totalWeight).slice(0, limit);
  }

  @get('/analytics/products/most-transactions')
  async getProductsByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both');
    return analytics.sort((a, b) => b.transactionCount - a.transactionCount).slice(0, limit);
  }

  @get('/analytics/products/least-transactions')
  async getProductsWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<ProductAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getProductAnalytics(startDate, endDate, 'both');
    return analytics
      .filter(p => p.transactionCount > 0) // Solo productos con al menos 1 transacción
      .sort((a, b) => a.transactionCount - b.transactionCount)
      .slice(0, limit);
  }

  @get('/analytics/suppliers/most-transactions')
  async getSuppliersByTransactionCount(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getSupplierAnalytics(startDate, endDate, 'both');
    return analytics.sort((a, b) => b.transactionCount - a.transactionCount).slice(0, limit);
  }

  @get('/analytics/suppliers/least-transactions')
  async getSuppliersWithLeastTransactions(
    @param.query.string('startDate') startDate: string,
    @param.query.string('endDate') endDate: string,
    @param.query.number('limit') limit: number = 10,
  ): Promise<SupplierAnalytics[]> {
    this.validateDateRange(startDate, endDate);
    const analytics = await this.getSupplierAnalytics(startDate, endDate, 'both');
    return analytics
      .filter(s => s.transactionCount > 0) // Solo proveedores con al menos 1 transacción
      .sort((a, b) => a.transactionCount - b.transactionCount)
      .slice(0, limit);
  }

  private async getSupplierAnalytics(
    startDate: string,
    endDate: string,
    type: 'purchases' | 'expenses' | 'both',
  ): Promise<SupplierAnalytics[]> {
    const supplierMap = new Map<number, SupplierAnalytics>();
    const dateFilter = this.createDateFilter(startDate, endDate);

    if (type === 'purchases' || type === 'both') {
      const purchases = await this.purchaseDetailsRepository.find({
        include: [
          {
            relation: 'purchase',
            scope: {
              where: { date: dateFilter },
            },
          },
          {
            relation: 'person',
          },
        ],
      });

      this.aggregateSupplierData(purchases, supplierMap);
    }

    if (type === 'expenses' || type === 'both') {
      const expenses = await this.expenseDetailsRepository.find({
        include: [
          {
            relation: 'expense',
            scope: {
              where: { date: dateFilter },
            },
          },
          {
            relation: 'person',
          },
        ],
      });

      this.aggregateSupplierData(expenses, supplierMap);
    }

    return Array.from(supplierMap.values());
  }

  private async getProductAnalytics(
    startDate: string,
    endDate: string,
    type: 'purchases' | 'expenses' | 'both',
  ): Promise<ProductAnalytics[]> {
    const productMap = new Map<number, ProductAnalytics>();
    const dateFilter = this.createDateFilter(startDate, endDate);

    if (type === 'purchases' || type === 'both') {
      const purchases = await this.purchaseDetailsRepository.find({
        include: [
          {
            relation: 'purchase',
            scope: {
              where: { date: dateFilter },
            },
          },
          {
            relation: 'product',
          },
        ],
      });

      this.aggregateProductData(purchases, productMap);
    }

    if (type === 'expenses' || type === 'both') {
      const expenses = await this.expenseDetailsRepository.find({
        include: [
          {
            relation: 'expense',
            scope: {
              where: { date: dateFilter },
            },
          },
          {
            relation: 'product',
          },
        ],
      });

      this.aggregateProductData(expenses, productMap);
    }

    return Array.from(productMap.values());
  }

  private aggregateSupplierData(
    transactions: any[], // Using any due to LoopBack's include relations typing
    supplierMap: Map<number, SupplierAnalytics>,
  ): void {
    for (const transaction of transactions) {
      // Skip transactions without required data or without valid date relation
      if (!transaction.person ||
          !transaction.weight_kg ||
          transaction.weight_kg <= 0 ||
          (!transaction.purchase && !transaction.expense)) {
        continue;
      }

      const personId = transaction.person.id;
      const existing = supplierMap.get(personId);

      if (existing) {
        existing.totalWeight += transaction.weight_kg;
        existing.transactionCount += 1;
      } else {
        supplierMap.set(personId, {
          personId,
          personName: transaction.person.name || `Proveedor ${personId}`,
          totalWeight: transaction.weight_kg,
          transactionCount: 1,
        });
      }
    }
  }

  private aggregateProductData(
    transactions: any[], // Using any due to LoopBack's include relations typing
    productMap: Map<number, ProductAnalytics>,
  ): void {
    for (const transaction of transactions) {
      // Skip transactions without required data or without valid date relation
      if (!transaction.product ||
          !transaction.weight_kg ||
          transaction.weight_kg <= 0 ||
          (!transaction.purchase && !transaction.expense)) {
        continue;
      }

      const productId = transaction.product.id;
      const existing = productMap.get(productId);

      if (existing) {
        existing.totalWeight += transaction.weight_kg;
        existing.transactionCount += 1;
      } else {
        productMap.set(productId, {
          productId,
          productName: transaction.product.name || `Producto ${productId}`,
          totalWeight: transaction.weight_kg,
          transactionCount: 1,
        });
      }
    }
  }

  private calculateSummary(
    supplierAnalytics: SupplierAnalytics[],
    productAnalytics: ProductAnalytics[],
  ): {
    totalSuppliers: number;
    totalProducts: number;
    totalWeight: number;
    totalTransactions: number;
  } {
    return {
      totalSuppliers: supplierAnalytics.length,
      totalProducts: productAnalytics.length,
      totalWeight: supplierAnalytics.reduce((sum, s) => sum + s.totalWeight, 0) +
                   productAnalytics.reduce((sum, p) => sum + p.totalWeight, 0),
      totalTransactions: supplierAnalytics.reduce((sum, s) => sum + s.transactionCount, 0) +
                        productAnalytics.reduce((sum, p) => sum + p.transactionCount, 0),
    };
  }

  private getTopResults<T extends {totalWeight: number}>(
    data: T[],
    mode: 'max' | 'min',
  ): T[] {
    if (data.length === 0) return [];

    const sortedData = data.sort((a, b) =>
      mode === 'max' ? b.totalWeight - a.totalWeight : a.totalWeight - b.totalWeight
    );

    const targetValue = sortedData[0].totalWeight;
    return sortedData.filter(item => item.totalWeight === targetValue);
  }

  private validateDateRange(startDate: string, endDate: string): void {
    if (!startDate || !endDate) {
      throw new HttpErrors.BadRequest('Both startDate and endDate are required');
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
      throw new HttpErrors.BadRequest('Invalid startDate format. Use YYYY-MM-DD');
    }
    if (!dateRegex.test(endDate)) {
      throw new HttpErrors.BadRequest('Invalid endDate format. Use YYYY-MM-DD');
    }

    // Validate date values
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
      throw new HttpErrors.BadRequest('Invalid startDate value');
    }
    if (isNaN(end.getTime())) {
      throw new HttpErrors.BadRequest('Invalid endDate value');
    }

    if (start > end) {
      throw new HttpErrors.BadRequest('startDate must be before or equal to endDate');
    }

    // Validate date range is not too large (optional business rule)
    const maxDaysRange = 365; // 1 year
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDaysRange) {
      throw new HttpErrors.BadRequest(`Date range cannot exceed ${maxDaysRange} days`);
    }
  }

  /**
   * Creates date filter object for database queries
   */
  private createDateFilter(startDate: string, endDate: string) {
    return {
      between: [startDate, endDate],
    };
  }

}
