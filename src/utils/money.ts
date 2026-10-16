/**
 * Money helpers.
 *
 * PesaTrack never stores money as a decimal number. "1250.50" cannot be
 * represented exactly by a computer's floating-point numbers, so adding
 * many amounts slowly drifts away from the truth:
 *
 *     0.1 + 0.2 === 0.30000000000000004   // true in JavaScript
 *
 * Instead, every amount is stored as a whole number of MINOR UNITS (cents):
 *
 *     KSh 1,250.50  ->  125050 minor units
 *
 * All arithmetic is then exact integer arithmetic. Conversion to and from a
 * readable string happens only at the edges: when the user types an amount,
 * and when we display one.
 */

/** An integer number of minor units (cents). 100 minor units = KSh 1.00. */
export type MinorUnits = number;

/** Minor units in one whole unit of currency. */
export const MINOR_UNITS_PER_UNIT = 100;

/** Currency symbol and code defaults for PesaTrack (Kenyan Shilling). */
export const DEFAULT_CURRENCY = {
  code: 'KES',
  symbol: 'KSh',
} as const;

/** Matches "1250", "1,250", "1250.5", "1,250.50". Rejects signs, letters, extra decimals. */
const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Converts user input into minor units.
 *
 * Returns `null` when the input is not a valid amount, so callers must decide
 * how to report the problem. Never guesses: "12.345" is rejected rather than
 * silently rounded, and negatives are rejected because a transaction amount is
 * always positive (direction is expressed by the transaction type).
 */
export function parseAmountToMinorUnits(input: string): MinorUnits | null {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (trimmed.length === 0) {
    return null;
  }

  const match = AMOUNT_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const wholeUnits = Number(trimmed.split('.')[0].replace(/,/g, ''));
  // Pad "5" -> "50" so that "1250.5" means 1250 shillings and 50 cents.
  const fractionalDigits = (match[1] ?? '').padEnd(2, '0');
  const value = wholeUnits * MINOR_UNITS_PER_UNIT + Number(fractionalDigits);

  return Number.isSafeInteger(value) ? value : null;
}

/** Adds thousands separators to a digits-only string: "1250500" -> "1,250,500". */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type FormatMoneyOptions = {
  /** Currency symbol, for example "KSh". Pass "" to omit it. */
  symbol?: string;
  /** Always show the explicit sign, e.g. "+KSh 500.00" / "-KSh 150.00". */
  showSign?: boolean;
  /** Hide the decimal part ("KSh 1,250"). Useful in tight summary cards. */
  hideDecimals?: boolean;
};

/**
 * Formats minor units for display, e.g. 125050 -> "KSh 1,250.50".
 *
 * This is deliberately deterministic rather than using Intl.NumberFormat:
 * phone runtimes differ in which locale data they ship, which would make the
 * same amount render differently on different devices. Grouping with commas
 * and a dot for decimals matches Kenyan usage.
 */
export function formatMinorUnits(amount: MinorUnits, options: FormatMoneyOptions = {}): string {
  const { symbol = DEFAULT_CURRENCY.symbol, showSign = false, hideDecimals = false } = options;

  const isNegative = amount < 0;
  const absolute = Math.abs(Math.trunc(amount));
  const wholeUnits = Math.floor(absolute / MINOR_UNITS_PER_UNIT);
  const cents = absolute % MINOR_UNITS_PER_UNIT;

  const wholeText = groupDigits(String(wholeUnits));
  const decimalText = hideDecimals ? '' : `.${String(cents).padStart(2, '0')}`;
  const sign = isNegative ? '-' : showSign ? '+' : '';
  const symbolText = symbol ? `${symbol} ` : '';

  return `${sign}${symbolText}${wholeText}${decimalText}`;
}

/** Formats a signed change, e.g. -45000 -> "-KSh 450.00". */
export function formatSignedMinorUnits(amount: MinorUnits, options: FormatMoneyOptions = {}): string {
  return formatMinorUnits(amount, { ...options, showSign: true });
}

/**
 * Converts minor units to a plain decimal string for exports and storage in
 * text-based formats: 125050 -> "1250.50".
 */
export function minorUnitsToDecimalString(amount: MinorUnits): string {
  const isNegative = amount < 0;
  const absolute = Math.abs(Math.trunc(amount));
  const wholeUnits = Math.floor(absolute / MINOR_UNITS_PER_UNIT);
  const cents = absolute % MINOR_UNITS_PER_UNIT;

  return `${isNegative ? '-' : ''}${wholeUnits}.${String(cents).padStart(2, '0')}`;
}

/**
 * Converts minor units to an editable input string: 125050 -> "1250.50".
 * Whole amounts lose the trailing ".00" so editing feels natural.
 */
export function minorUnitsToInputString(amount: MinorUnits): string {
  const decimal = minorUnitsToDecimalString(amount);
  return decimal.endsWith('.00') ? decimal.slice(0, -3) : decimal;
}

/** Exact sum of many amounts. */
export function sumMinorUnits(amounts: readonly MinorUnits[]): MinorUnits {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/** True when the value is a usable, non-negative integer amount. */
export function isValidMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Percentage of `total` represented by `part`, safe against division by zero.
 * Returns `null` when the total is zero, because "0 of 0" has no meaningful
 * percentage — callers show "No Budget Set" instead of inventing a number.
 */
export function percentageOf(part: MinorUnits, total: MinorUnits): number | null {
  if (total <= 0) {
    return null;
  }
  return (part / total) * 100;
}
