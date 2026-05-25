import { BindingScope, injectable } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'

export enum FilterType {
  DAY = 'day',
  MONTH = 'month',
}

@injectable({ scope: BindingScope.TRANSIENT })
export class DateFilteringService {
  constructor() {}

  /**
   * Validates date string depending on the filter type (DAY: YYYY-MM-DD, MONTH: YYYY-MM)
   * @param dateValue
   * @param filterType
   */
  public validateDateFormat(dateValue: string, filterType: FilterType): void {
    const dayRegex = /^\d{4}-\d{2}-\d{2}$/ // YYYY-MM-DD
    const monthRegex = /^\d{4}-\d{2}$/ // YYYY-MM

    if (!dateValue) {
      throw new HttpErrors.BadRequest('Date value is required')
    }

    const dateParts = dateValue.split('-')
    if (dateParts.some(part => parseInt(part, 10) <= 0)) {
      throw new HttpErrors.BadRequest('Date values must be greater than 0')
    }

    if (filterType === FilterType.DAY && !dayRegex.test(dateValue)) {
      throw new HttpErrors.BadRequest('Invalid day format. Use YYYY-MM-DD')
    }

    if (filterType === FilterType.MONTH && !monthRegex.test(dateValue)) {
      throw new HttpErrors.BadRequest('Invalid month format. Use YYYY-MM')
    }
  }

  /**
   * Generates start and end dates based on the provided date and filter type
   * @param dateValue
   * @param filterType
   */
  public getDateRange(
    dateValue: string,
    filterType: FilterType,
  ): { startDate: Date; endDate: Date } {
    let startDate: Date
    let endDate: Date

    if (filterType === FilterType.DAY) {
      startDate = new Date(`${dateValue}T00:00:00Z`)
      endDate = new Date(`${dateValue}T23:59:59.999Z`)
    } else {
      // MONTH filter
      startDate = new Date(`${dateValue}-01T00:00:00Z`)
      const [year, month] = dateValue.split('-')
      // Next month day 1 minus 1 ms = last day of current month
      endDate = new Date(
        new Date(`${year}-${parseInt(month) + 1}-01T00:00:00Z`).getTime() - 1,
      )
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new HttpErrors.BadRequest(
        'Invalid date values resulting in invalid Dates',
      )
    }

    return { startDate, endDate }
  }
}
