import {
  dateRangeTooLargeMessage,
  invalidDateFormatMessage,
  invalidDateValueMessage,
  invalidDateYearMessage,
  USER_MESSAGES,
  ValidationError,
} from '../errors'

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 1000 * 60 * 60 * 24
const MAX_DAYS_RANGE = 365

export function validateDate(date: string): void {
  if (!date) {
    throw new ValidationError(USER_MESSAGES.DATE_INVALID_FORMAT)
  }

  const dateOnly = DATE_ONLY_REGEX.exec(date)
  const inputDate = dateOnly ? parseDateOnly(date, 'date') : new Date(date)

  if (isNaN(inputDate.getTime())) {
    throw new ValidationError(USER_MESSAGES.DATE_INVALID_FORMAT)
  }

  const year = dateOnly ? Number(dateOnly[1]) : inputDate.getUTCFullYear()
  const currentYear = new Date().getUTCFullYear()
  if (year < 2000 || year > currentYear) {
    throw new ValidationError(invalidDateYearMessage(currentYear))
  }
}

export function validateDateRange(startDate: string, endDate: string): void {
  if (!startDate || !endDate) {
    throw new ValidationError(USER_MESSAGES.DATE_RANGE_REQUIRED)
  }

  if (!DATE_ONLY_REGEX.test(startDate)) {
    throw new ValidationError(invalidDateFormatMessage('startDate'))
  }
  if (!DATE_ONLY_REGEX.test(endDate)) {
    throw new ValidationError(invalidDateFormatMessage('endDate'))
  }

  const start = parseDateOnly(startDate, 'startDate')
  const end = parseDateOnly(endDate, 'endDate')

  if (start > end) {
    throw new ValidationError(USER_MESSAGES.DATE_RANGE_ORDER)
  }

  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY)
  if (daysDiff > MAX_DAYS_RANGE) {
    throw new ValidationError(dateRangeTooLargeMessage(MAX_DAYS_RANGE))
  }
}

function parseDateOnly(date: string, label: string): Date {
  const match = DATE_ONLY_REGEX.exec(date)
  if (!match) {
    throw new ValidationError(invalidDateFormatMessage(label))
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
    throw new ValidationError(invalidDateValueMessage(label))
  }

  return parsed
}
