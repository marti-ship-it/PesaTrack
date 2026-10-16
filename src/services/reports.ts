import type { SQLiteDatabase } from 'expo-sqlite';

import { listBudgetsForMonth } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import { getSettings } from '@/db/repositories/settings';
import {
  countTransactionsInRange,
  getCategoryBreakdownWithNames,
  getTotalsForPeriod,
  type CategoryBreakdownWithNames,
  type Period,
} from '@/db/repositories/reports';
import { summarizeTransactions, type TransactionTotals } from '@/db/repositories/transactions';
import { buildCategoryBudgetRow, type CategoryBudgetRow } from '@/services/budgets';
import type { Category, MonthlyBudget } from '@/types/models';
import {
  addMonths,
  formatMonthLabel,
  formatShortMonthLabel,
  isValidMonthKey,
  monthRange,
  periodMonthKey,
  todayIso,
  type MonthKey,
  type MonthRange,
} from '@/utils/dates';

/**
 * The calculation rules for the Reports screen.
 *
 * Reports never invent numbers: every figure comes from the same SQL the rest
 * of the app uses, so a total on Reports always agrees with the dashboard,
 * transactions list and Budgets screen:
 *
 *   - **Expenses are net of refunds** (`NET_AMOUNT_EXPRESSION`), the same
 *     expression the dashboard and M5 budgets use — a refund reduces the
 *     spending it reverses instead of counting as new spending.
 *   - **Savings movements are transfers, not income or expense.** They are
 *     kept out of both totals (as `summarizeTransactions` already does) so a
 *     transfer can never inflate spending or income. Savings analytics are a
 *     later milestone; nothing here reports on them.
 *   - **Financial months come from settings**, exactly like Budgets:
 *     `periodMonthKey` and `monthRange` honour `financialMonthStartDay`, so
 *     Reports and Budgets always talk about the same period.
 *
 * Needs-vs-want analysis, savings summaries, unexpected-expense summaries and
 * recurring transactions are deliberately deferred; this module does not
 * attempt them.
 */

export type MonthlyComparison = {
  currentMonthKey: MonthKey;
  previousMonthKey: MonthKey;
  current: TransactionTotals;
  previous: TransactionTotals;
  incomeDeltaMinorUnits: number;
  expensesDeltaMinorUnits: number;
  /** False when the previous period holds no transactions at all. */
  hasPreviousData: boolean;
};

/** One category's share of the period's spending, ready for display. */
export type CategoryShareRow = {
  categoryId: string;
  name: string;
  icon: string | null;
  /** Net of refunds; can be negative for refund-heavy periods. */
  netMinorUnits: number;
  /** Percentage of the period's positive net spend. `null` when no spending. */
  sharePercent: number | null;
};

export type ReportsData = {
  monthKey: MonthKey;
  /** "October 2026". */
  monthLabel: string;
  /** Inclusive dates of the selected financial month. */
  range: MonthRange;
  currencySymbol: string;
  /** Income and net expenses for the selected month. */
  totals: TransactionTotals;
  /** Previous financial month's totals, and the deltas against it. */
  comparison: MonthlyComparison;
  /** Expense categories for the month, biggest net spender first. */
  breakdown: CategoryShareRow[];
  /** Last six financial months, oldest first, for the trend section. */
  series: { monthKey: MonthKey; label: string; totals: TransactionTotals }[];
  /** Budget performance rows from M5, most at-risk first. */
  budgetRows: BudgetPerformanceRow[];
  /** Every transaction in the database. `0` means show the full empty state. */
  totalTransactionCount: number;
};

/**
 * Budget performance rows reuse M5's `CategoryBudgetRow` shape, so the screen
 * can render them with the same `BudgetRow` component as the Budgets screen.
 */
export type BudgetPerformanceRow = CategoryBudgetRow;

/**
 * Builds the month-over-month comparison. Pure so the delta rule (and the
 * "previous period was empty" signal) can be pinned down in tests.
 */
export function buildMonthlyComparison(params: {
  currentMonthKey: MonthKey;
  previousMonthKey: MonthKey;
  current: TransactionTotals;
  previous: TransactionTotals;
  previousTransactionCount: number;
}): MonthlyComparison {
  const { current, previous, previousTransactionCount } = params;
  return {
    currentMonthKey: params.currentMonthKey,
    previousMonthKey: params.previousMonthKey,
    current,
    previous,
    incomeDeltaMinorUnits: current.incomeMinorUnits - previous.incomeMinorUnits,
    expensesDeltaMinorUnits: current.expensesNetMinorUnits - previous.expensesNetMinorUnits,
    hasPreviousData: previousTransactionCount > 0,
  };
}

/**
 * Attaches each category's share of spending to its net total.
 *
 * Sorted biggest spender first; the share is measured against the sum of
 * positive net spending, because "share of a negative total" is meaningless
 * when refunds outweigh spending. Categories with no positive spending get
 * `sharePercent: null` rather than an invented percentage.
 */
export function buildCategoryShares(
  breakdown: CategoryBreakdownWithNames,
  categories: readonly Category[]
): CategoryShareRow[] {
  const categoryById = new Map(categories.map((category) => [category.id, category] as const));

  const positiveTotal = breakdown.reduce(
    (sum, item) => (item.netMinorUnits > 0 ? sum + item.netMinorUnits : sum),
    0
  );

  return breakdown
    .map((item) => {
      const category = categoryById.get(item.categoryId);
      return {
        categoryId: item.categoryId,
        name: category?.name ?? item.name,
        icon: category?.icon ?? null,
        netMinorUnits: item.netMinorUnits,
        sharePercent:
          item.netMinorUnits > 0 && positiveTotal > 0
            ? (item.netMinorUnits / positiveTotal) * 100
            : null,
      };
    })
    .sort(
      (a, b) =>
        b.netMinorUnits - a.netMinorUnits || a.name.localeCompare(b.name)
    );
}

/**
 * The full empty state appears only when the user has no transactions at all.
 * A month with no activity still has real history to summarise, so the screen
 * shows its zero totals instead of hiding them.
 */
export function hasAnyTransactions(totalTransactionCount: number): boolean {
  return totalTransactionCount > 0;
}

/**
 * Loads everything the Reports screen needs for one financial month.
 *
 * Follows `getBudgetsData`'s shape on purpose: resolve the month from
 * settings (or an explicit key), then read every figure in parallel.
 */
export async function getReportsData(db: SQLiteDatabase, monthKey?: MonthKey): Promise<ReportsData> {
  const settings = await getSettings(db);

  const resolvedMonthKey =
    monthKey && isValidMonthKey(monthKey)
      ? monthKey
      : periodMonthKey(todayIso(), settings.financialMonthStartDay);

  const range = monthRange(resolvedMonthKey, settings.financialMonthStartDay);
  if (!range) {
    throw new Error('Could not work out the selected reporting month.');
  }

  const previousMonthKey = addMonths(resolvedMonthKey, -1);
  const previousRange = monthRange(previousMonthKey, settings.financialMonthStartDay);
  if (!previousRange) {
    throw new Error('Could not work out the previous reporting month.');
  }

  // Six months of trend, oldest first, built from the same `monthRange` rule.
  const seriesMonths: { monthKey: MonthKey; range: MonthRange }[] = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const key = addMonths(resolvedMonthKey, offset);
    const monthRangeValue = monthRange(key, settings.financialMonthStartDay);
    if (monthRangeValue) {
      seriesMonths.push({ monthKey: key, range: monthRangeValue });
    }
  }

  const period: Period = { from: range.start, to: range.end };
  const previousPeriod: Period = { from: previousRange.start, to: previousRange.end };

  const [
    totals,
    previousTotals,
    previousCount,
    breakdown,
    categories,
    budgets,
    totalTransactionCount,
    seriesTotals,
  ] = await Promise.all([
    getTotalsForPeriod(db, period),
    summarizeTransactions(db, { from: previousPeriod.from, to: previousPeriod.to }),
    countTransactionsInRange(db, previousPeriod),
    getCategoryBreakdownWithNames(db, period),
    listCategories(db, { includeInactive: true }),
    listBudgetsForMonth(db, resolvedMonthKey),
    countTransactionsInRange(db),
    Promise.all(
      seriesMonths.map((entry) =>
        summarizeTransactions(db, { from: entry.range.start, to: entry.range.end })
      )
    ),
  ]);

  const budgetRows = buildBudgetPerformanceRows(
    categories,
    budgets,
    breakdown,
    settings.budgetWarningThresholdPercent
  );

  return {
    monthKey: resolvedMonthKey,
    monthLabel: formatMonthLabel(resolvedMonthKey),
    range,
    currencySymbol: settings.currencySymbol,
    totals,
    comparison: buildMonthlyComparison({
      currentMonthKey: resolvedMonthKey,
      previousMonthKey,
      current: totals,
      previous: previousTotals,
      previousTransactionCount: previousCount,
    }),
    breakdown: buildCategoryShares(breakdown, categories),
    series: seriesMonths.map((entry, index) => ({
      monthKey: entry.monthKey,
      label: formatShortMonthLabel(entry.monthKey),
      totals: seriesTotals[index],
    })),
    budgetRows,
    totalTransactionCount,
  };
}

/**
 * Budget performance: the M5 budgets for the month joined with actual net
 * spending, so Reports and Budgets can never disagree about a number.
 *
 * Rows are built with `buildCategoryBudgetRow` — the very function the
 * Budgets screen uses — so status, remaining amount and progress bar maths are
 * identical in both places. Only categories with a budget appear: a category
 * without a limit has no "performance" to report, and inventing a zero budget
 * would misrepresent it. Ordering matches the Budgets screen (most at-risk
 * first).
 */
function buildBudgetPerformanceRows(
  categories: readonly Category[],
  budgets: readonly MonthlyBudget[],
  breakdown: CategoryBreakdownWithNames,
  thresholdPercent: number
): BudgetPerformanceRow[] {
  const budgetByCategoryId = new Map(
    budgets.map((budget) => [budget.categoryId, budget.budgetedMinorUnits] as const)
  );
  const spentByCategoryId = new Map(
    breakdown.map((item) => [item.categoryId, item.netMinorUnits] as const)
  );

  const rows: BudgetPerformanceRow[] = [];
  for (const category of categories) {
    if (category.type !== 'expense') {
      continue;
    }
    const budgeted = budgetByCategoryId.get(category.id);
    if (budgeted === undefined) {
      continue;
    }
    rows.push(
      buildCategoryBudgetRow(
        category,
        budgeted,
        spentByCategoryId.get(category.id) ?? 0,
        thresholdPercent
      )
    );
  }

  const STATUS_ORDER = { exceeded: 0, reached: 1, near: 2, under: 3 } as const;
  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.percentUsed - a.percentUsed ||
      a.categoryName.localeCompare(b.categoryName)
  );
  return rows;
}
