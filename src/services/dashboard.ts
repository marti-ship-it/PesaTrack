import type { SQLiteDatabase } from 'expo-sqlite';

import { getSettings } from '@/db/repositories/settings';
import {
  countTransactions,
  summarizeTransactions,
  type TransactionTotals,
} from '@/db/repositories/transactions';
import {
  formatMonthLabel,
  monthRange,
  periodMonthKey,
  todayIso,
  type IsoDate,
  type MonthRange,
} from '@/utils/dates';

/**
 * The calculation rules for the Home dashboard.
 *
 * Every figure on Home derives from `summarizeTransactions` (one SQL pass, all
 * integers) plus `buildDashboardTotals` below. There is no second implementation
 * anywhere: the screen, the tests and any future report all go through these
 * two functions, so a rule can never drift between them.
 *
 * Two scopes are deliberately different:
 *
 *   - **The three tiles** (income, expenses, savings) describe the *selected
 *     period* — the current financial month or all time.
 *   - **Current balance** is a point in time, so it always sums *every* recorded
 *     transaction, regardless of the selected period. It is cash on hand: the
 *     opening balance plus income, minus net expenses, minus money that moved
 *     into savings, plus money that came back out.
 */

/** Which slice of history the three period tiles describe. */
export type DashboardPeriod = 'financial-month' | 'all-time';

export type DashboardTotals = {
  /** Cash on hand, all time. Can legitimately be negative. */
  currentBalanceMinorUnits: number;
  totalIncomeMinorUnits: number;
  /** Net of refunds. Can legitimately be negative in a refund-only period. */
  totalExpensesMinorUnits: number;
  /** Net movement into savings during the period (deposits − withdrawals). */
  savedThisPeriodMinorUnits: number;
};

export type DashboardData = {
  period: DashboardPeriod;
  /** Inclusive range of the selected period, or null when it is all time. */
  range: MonthRange | null;
  totals: DashboardTotals;
  /** Total recorded transactions, used to pick between list and empty state. */
  transactionCount: number;
  currencySymbol: string;
  /** "October 2026" for a financial month, "All time" otherwise. */
  periodLabel: string;
};

/**
 * The single place the four displayed numbers are derived.
 *
 * Rules, in integer minor units:
 *
 *   balance    = opening balance + all-time income − all-time net expenses
 *                − savings deposited + savings withdrawn
 *   income     = period income                      (savings never included)
 *   expenses   = period expenses net of refunds     (savings never included)
 *   this period= period savings in − period savings out
 *
 * Savings affect only the balance and the savings tile — never income or
 * expenses — because a saving row moves money between pots instead of spending
 * it. Refunds are already netted against expenses by the SQL layer, so a refund
 * correctly puts money back into the balance.
 */
export function buildDashboardTotals(
  periodTotals: TransactionTotals,
  allTimeTotals: TransactionTotals,
  startingBalanceMinorUnits: number
): DashboardTotals {
  return {
    currentBalanceMinorUnits:
      startingBalanceMinorUnits +
      allTimeTotals.incomeMinorUnits -
      allTimeTotals.expensesNetMinorUnits -
      allTimeTotals.savingsInMinorUnits +
      allTimeTotals.savingsOutMinorUnits,
    totalIncomeMinorUnits: periodTotals.incomeMinorUnits,
    totalExpensesMinorUnits: periodTotals.expensesNetMinorUnits,
    savedThisPeriodMinorUnits:
      periodTotals.savingsInMinorUnits - periodTotals.savingsOutMinorUnits,
  };
}

/**
 * The inclusive date range of the selected period.
 *
 * Returns null for `all-time`, which means "apply no date filter". For a
 * financial month the range honours `financialMonthStartDay`, so with a start
 * day of 25 and today 16 Oct 2026 the period runs 25 Sep – 24 Oct 2026.
 *
 * Throws rather than silently falling back to all time when the date cannot be
 * resolved — an unknown range would quietly show wrong totals on screen.
 */
export function resolveDashboardRange(
  period: DashboardPeriod,
  financialMonthStartDay: number,
  today: IsoDate
): MonthRange | null {
  if (period === 'all-time') {
    return null;
  }

  const range = monthRange(
    periodMonthKey(today, financialMonthStartDay),
    financialMonthStartDay
  );

  if (!range) {
    throw new Error('Could not work out the current financial month.');
  }

  return range;
}

/**
 * Loads everything Home needs in one go: settings, period totals, all-time
 * totals (for the balance) and the transaction count.
 *
 * `today` is injectable so month-boundary behaviour can be tested without
 * waiting for a particular calendar date.
 */
export async function getDashboardData(
  db: SQLiteDatabase,
  period: DashboardPeriod,
  today: IsoDate = todayIso()
): Promise<DashboardData> {
  const settings = await getSettings(db);
  const range = resolveDashboardRange(period, settings.financialMonthStartDay, today);

  const [allTimeTotals, transactionCount] = await Promise.all([
    summarizeTransactions(db),
    countTransactions(db),
  ]);

  // For "all time" the period *is* all time, so reuse the one result instead
  // of running the identical query twice.
  const periodTotals = range
    ? await summarizeTransactions(db, { from: range.start, to: range.end })
    : allTimeTotals;

  const periodLabel =
    range === null
      ? 'All time'
      : formatMonthLabel(periodMonthKey(today, settings.financialMonthStartDay));

  return {
    period,
    range,
    totals: buildDashboardTotals(periodTotals, allTimeTotals, settings.startingBalanceMinorUnits),
    transactionCount,
    currencySymbol: settings.currencySymbol,
    periodLabel,
  };
}
