import { HttpErrors } from '@loopback/rest'

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 1000 * 60 * 60 * 24

export function validateDate(date: string): void {
  if (!date) {
    throw new HttpErrors.BadRequest('Invalid date format.')
  }

  const dateOnly = DATE_ONLY_REGEX.exec(date)
  const inputDate = dateOnly ? parseDateOnly(date, 'date') : new Date(date)

  if (isNaN(inputDate.getTime())) {
    throw new HttpErrors.BadRequest('Invalid date format.')
  }

  const year = dateOnly ? Number(dateOnly[1]) : inputDate.getUTCFullYear()
  const currentYear = new Date().getUTCFullYear()
  if (year < 2000 || year > currentYear) {
    throw new HttpErrors.BadRequest(
      `Invalid date. Year must be between 2000 and ${currentYear}.`,
    )
  }
}

export function validateDateRange(startDate: string, endDate: string): void {
  if (!startDate || !endDate) {
    throw new HttpErrors.BadRequest('Both startDate and endDate are required')
  }

  if (!DATE_ONLY_REGEX.test(startDate)) {
    throw new HttpErrors.BadRequest('Invalid startDate format. Use YYYY-MM-DD')
  }
  if (!DATE_ONLY_REGEX.test(endDate)) {
    throw new HttpErrors.BadRequest('Invalid endDate format. Use YYYY-MM-DD')
  }

  const start = parseDateOnly(startDate, 'startDate')
  const end = parseDateOnly(endDate, 'endDate')

  if (start > end) {
    throw new HttpErrors.BadRequest(
      'startDate must be before or equal to endDate',
    )
  }

  const maxDaysRange = 365
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY)
  if (daysDiff > maxDaysRange) {
    throw new HttpErrors.BadRequest(
      `Date range cannot exceed ${maxDaysRange} days`,
    )
  }
}

function parseDateOnly(date: string, label: string): Date {
  const match = DATE_ONLY_REGEX.exec(date)
  if (!match) {
    throw new HttpErrors.BadRequest(`Invalid ${label} format. Use YYYY-MM-DD`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new HttpErrors.BadRequest(`Invalid ${label} value`)
  }

  return parsed
}
