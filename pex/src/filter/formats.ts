/**
 * The `format` keyword, and the `formatMinimum` / `formatMaximum` comparison keywords that
 * `ajv-formats` adds and that Presentation Exchange definitions use to bound dates.
 *
 * Only formats that can be checked without a dependency are implemented. An unrecognised format
 * is *ignored*, which is what JSON Schema specifies and what ajv does by default — unlike an
 * unknown *keyword*, an unknown format is an annotation, not a dropped assertion.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
// The offset is optional for a time, as in ajv-formats, but required for a date-time, as RFC 3339 requires:
// without one a date-time is not an instant, and comparing it would depend on the host's timezone.
const TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(z|Z|[+-]\d{2}:\d{2})?$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(\.\d+)?(z|Z|[+-]\d{2}:\d{2})$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const max = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  return max !== undefined && day <= max
}

function isDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  return isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]))
}

function isTime(value: string): boolean {
  const match = TIME.exec(value)
  if (!match) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3])
  // 23:59:60 is a valid leap second.
  return hour <= 23 && minute <= 59 && second <= 60
}

function isDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value)
  if (!match) return false
  const [date, time] = value.split(/[tT]/)
  return date !== undefined && time !== undefined && isDate(date) && isTime(time)
}

const URI = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const HOSTNAME =
  /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4}:){1,7}:|:(:[0-9a-fA-F]{1,4}){1,7}|([0-9a-fA-F]{1,4}:){1,6}(:[0-9a-fA-F]{1,4}){1,1}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5})$/

const validators: Record<string, (value: string) => boolean> = {
  date: isDate,
  time: isTime,
  'date-time': isDateTime,
  uri: (value) => URI.test(value),
  'uri-reference': (value) => value.length > 0,
  email: (value) => EMAIL.test(value),
  uuid: (value) => UUID.test(value),
  hostname: (value) => HOSTNAME.test(value),
  ipv4: (value) => IPV4.test(value),
  ipv6: (value) => IPV6.test(value),
}

/**
 * Whether the format is one this library can check. Unknown formats are ignored rather than
 * failing, so this exists mainly so callers can be told what is and is not enforced.
 */
export function isKnownFormat(format: string): boolean {
  return format in validators
}

/**
 * Check a value against a format. Returns `undefined` when the format is not recognised, which
 * the caller treats as "no assertion".
 */
export function checkFormat(format: string, value: string): boolean | undefined {
  const validator = validators[format]
  if (validator === undefined) return undefined
  return validator(value)
}

/**
 * Formats that support the `formatMinimum` / `formatMaximum` comparison keywords: those with a
 * total ordering.
 */
const comparableFormats = new Set(['date', 'time', 'date-time'])

export function isComparableFormat(format: string): boolean {
  return comparableFormats.has(format)
}

/** The offset of a `Z` / `+hh:mm` / `-hh:mm` suffix in minutes, or `undefined` when there is none. */
function offsetMinutes(offset: string | undefined): number | undefined {
  if (offset === undefined) return undefined
  if (offset === 'z' || offset === 'Z') return 0
  const sign = offset[0] === '-' ? -1 : 1
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
}

/** Milliseconds since the epoch for a UTC date and time. Unlike `Date.UTC`, years below 100 are not 19xx. */
function utc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  return date.getTime()
}

/** Milliseconds, with the sub-millisecond digits of the fraction kept as a fraction. */
function fractionMilliseconds(fraction: string | undefined): number {
  return fraction === undefined ? 0 : Number(`0${fraction}`) * 1000
}

/**
 * A date-time as milliseconds since the epoch, computed from its parts rather than with `Date.parse`, which
 * rejects a leap second. `23:59:60` orders as the first instant of the next day.
 */
function dateTimeToEpochMilliseconds(value: string): number | undefined {
  const match = DATE_TIME.exec(value)
  if (!match || !isDateTime(value)) return undefined
  const [, year, month, day, hour, minute, second, fraction, offset] = match
  const epoch = utc(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  return epoch + fractionMilliseconds(fraction) - (offsetMinutes(offset) ?? 0) * 60_000
}

/** A time as milliseconds since midnight, in UTC when it has an offset. */
function timeToMilliseconds(value: string): { milliseconds: number; hasOffset: boolean } | undefined {
  const match = TIME.exec(value)
  if (!match || !isTime(value)) return undefined
  const [, hour, minute, second, fraction, offset] = match
  const local = ((Number(hour) * 60 + Number(minute)) * 60 + Number(second)) * 1000 + fractionMilliseconds(fraction)
  const minutes = offsetMinutes(offset)
  return { milliseconds: local - (minutes ?? 0) * 60_000, hasOffset: minutes !== undefined }
}

/**
 * Compare two values of the same format, returning a negative number, zero or a positive number
 * the way a sort comparator does. Returns `undefined` when either value is not valid for the
 * format, or the format is not comparable.
 *
 * `date` and `date-time` are compared as instants. Two `time`s are compared as times of day, in UTC when
 * both have an offset. A time with an offset and one without cannot be ordered, so they compare as
 * `undefined`.
 */
export function compareFormat(format: string, left: string, right: string): number | undefined {
  if (!isComparableFormat(format)) return undefined
  if (checkFormat(format, left) !== true || checkFormat(format, right) !== true) return undefined

  if (format === 'time') {
    const a = timeToMilliseconds(left)
    const b = timeToMilliseconds(right)
    if (a === undefined || b === undefined || a.hasOffset !== b.hasOffset) return undefined
    return a.milliseconds - b.milliseconds
  }

  if (format === 'date') {
    const toEpoch = (value: string) => {
      const [year, month, day] = value.split('-').map(Number) as [number, number, number]
      return utc(year, month, day)
    }
    return toEpoch(left) - toEpoch(right)
  }

  const a = dateTimeToEpochMilliseconds(left)
  const b = dateTimeToEpochMilliseconds(right)
  if (a === undefined || b === undefined) return undefined
  return a - b
}
