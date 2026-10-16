/**
 * Date helpers.
 *
 * Two rules keep PesaTrack's reporting correct:
 *
 * 1. **Dates are stored as local calendar strings** (`"2026-10-15"`), never as
 *    timestamps. A timestamp like `2026-10-31T22:00:00Z` is the 1st of
 *    November for a user in Nairobi, which silently moves a transaction into
 *    the wrong month.
 *
 * 2. **Date strings are parsed by hand**, not with `new Date(text)`.
 *    JavaScript parses `"2026-10-15"` as *UTC midnight*, so
 *    `new Date("2026-10-15").getDate()` can return 14 in some time zones.
 *
 * Because ISO date strings sort and compare lexicographically, filtering a
 * month becomes a simple range comparison in SQLite:
 *
 *     WHERE date >= '2026-10-01' AND date <= '2026-10-31'
 *
 * A "financial month" may start on any day the user chooses (for example, if
 * money arrives around the 25th). `MonthKey` always names the month in which
 * the period **begins**.
 */

/** Local calendar date, formatted `YYYY-MM-DD`. */
export type IsoDate = string;

/** Reporting month, formatted `YYYY-MM`. */
export type MonthKey = string;

/** A financial month may start on any day from the 1st to the 28th. */
export const MIN_FINANCIAL_MONTH_START_DAY = 1;
export const MAX_FINANCIAL_MONTH_START_DAY = 28;
export const DEFAULT_FINANCIAL_MONTH_START_DAY = 1;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Indexed by `Date.getDay()`, which starts at Sunday. */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Number of days in a month. `monthIndex` is zero-based (0 = January). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Converts a `Date` to a local `"YYYY-MM-DD"` string.
 * Uses local getters on purpose — see the note at the top of this file.
 */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today's local calendar date. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/**
 * Parses `"YYYY-MM-DD"` into a local `Date` at midnight.
 * Returns `null` for impossible dates such as `"2026-02-30"`.
 */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > daysInMonth(year, monthIndex)) {
    return null;
  }

  return new Date(year, monthIndex, day);
}

/** True when the string is a real calendar date in `YYYY-MM-DD` form. */
export function isValidIsoDate(value: string): value is string {
  return parseIsoDate(value) !== null;
}

/** The month (`"YYYY-MM"`) that a date falls in. */
export function monthKeyOf(date: string | Date): string {
  const parsed = typeof date === 'string' ? parseIsoDate(date) : date;
  if (!parsed) {
    return '';
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`;
}

/** This month, as `"YYYY-MM"`. */
export function currentMonthKey(): string {
  return monthKeyOf(new Date());
}

/** True when the string is a valid `YYYY-MM` month key. */
export function isValidMonthKey(value: string): boolean {
  const match = MONTH_KEY_PATTERN.exec(value.trim());
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Moves a month key forward or backward, e.g. addMonths("2026-01", -1) -> "2025-12". */
export function addMonths(monthKey: string, delta: number): string {
  const match = MONTH_KEY_PATTERN.exec(monthKey.trim());
  if (!match) {
    return monthKey;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const shifted = new Date(year, monthIndex + delta, 1);

  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`;
}

export type MonthRange = {
  /** First day of the reporting period, inclusive. */
  start: string;
  /** Last day of the reporting period, inclusive. */
  end: string;
};

/**
 * The inclusive date range covered by a financial month.
 *
 * With `startDay = 1` this is simply the calendar month. With, say, a start day
 * of 25, the reporting month `"2026-10"` covers 25 Oct 2026 – 24 Nov 2026,
 * because that is the period the user thinks of as "October's money".
 */
export function monthRange(
  monthKey: string,
  financialMonthStartDay: number = DEFAULT_FINANCIAL_MONTH_START_DAY
): MonthRange | null {
  if (!isValidMonthKey(monthKey)) {
    return null;
  }

  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (financialMonthStartDay <= 1) {
    const start = `${year}-${pad2(monthIndex + 1)}-01`;
    const end = `${year}-${pad2(monthIndex + 1)}-${pad2(daysInMonth(year, monthIndex))}`;
    return { start, end };
  }

  const start = `${year}-${pad2(monthIndex + 1)}-${pad2(financialMonthStartDay)}`;
  const nextMonthIndex = monthIndex + 1;
  const endYear = nextMonthIndex > 11 ? year + 1 : year;
  const endMonthIndex = nextMonthIndex > 11 ? 0 : nextMonthIndex;
  const end = `${endYear}-${pad2(endMonthIndex + 1)}-${pad2(financialMonthStartDay - 1)}`;

  return { start, end };
}

/**
 * The month a date belongs to, taking the financial month start day into
 * account. With a start day of 25, 10 Nov 2026 belongs to the "2026-10" period.
 */
export function periodMonthKey(
  date: string | Date,
  financialMonthStartDay: number = DEFAULT_FINANCIAL_MONTH_START_DAY
): string {
  const parsed = typeof date === 'string' ? parseIsoDate(date) : date;
  if (!parsed) {
    return '';
  }

  const key = monthKeyOf(parsed);

  if (financialMonthStartDay <= 1 || parsed.getDate() >= financialMonthStartDay) {
    return key;
  }

  return addMonths(key, -1);
}

/** `"2026-10"` -> `"October 2026"`. */
export function formatMonthLabel(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) {
    return '';
  }
  const [yearText, monthText] = monthKey.split('-');
  return `${MONTH_NAMES[Number(monthText) - 1]} ${yearText}`;
}

/** `"2026-10"` -> `"Oct 2026"`, for compact labels. */
export function formatShortMonthLabel(monthKey: string): string {
  if (!isValidMonthKey(monthKey)) {
    return '';
  }
  const [yearText, monthText] = monthKey.split('-');
  return `${SHORT_MONTH_NAMES[Number(monthText) - 1]} ${yearText}`;
}

/** `"2026-10-15"` -> `"15 Oct 2026"`. */
export function formatDateLabel(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return '';
  }
  return `${parsed.getDate()} ${SHORT_MONTH_NAMES[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/** `"2026-10-15"` -> `"Thursday, 15 Oct 2026"`. */
export function formatDateWithWeekday(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return '';
  }
  return `${WEEKDAY_NAMES[parsed.getDay()]}, ${formatDateLabel(isoDate)}`;
}

/** Shifts a date by a number of days, staying on the local calendar. */
export function addDays(date: string, delta: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) {
    return '';
  }
  parsed.setDate(parsed.getDate() + delta);
  return toIsoDate(parsed);
}

/** True when `date` falls inside an inclusive range. */
export function isWithinRange(date: string, range: MonthRange): boolean {
  return date >= range.start && date <= range.end;
}

/** Whole days between two dates (positive when `to` is later). */
export function daysBetween(from: string, to: string): number | null {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) {
    return null;
  }
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
}
