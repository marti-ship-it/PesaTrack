import type { SQLiteDatabase } from 'expo-sqlite';

import { listBudgetsForMonth } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import { getSettings } from '@/db/repositories/settings';
import { summarizeExpensesByCategory } from '@/db/repositories/transactions';
import type { Category, MonthlyBudget } from '@/types/models';
import {
  formatMonthLabel,
  isValidMonthKey,
  monthRange,
  periodMonthKey,
  todayIso,
  type MonthKey,
  type MonthRange,
} from '@/utils/dates';
import { parseAmountToMinorUnits, percentageOf } from '@/utils/money';

/**
 * The calculation rules for the Budgets screen.
 *
 * Everything Home-style is avoided here: this module knows what a budget *is*,
 * how spent money compares to it, and how to load the two together. It renders
 * nothing. Splitting the pure rules (`resolveBudgetStatus`, `buildBudgetRows`)
 * from the loader (`getBudgetsData`) is what lets the awkward cases —
 * refund-only categories, custom financial-month starts, retired categories —
 * be tested without a phone or a database.
 *
 * Two invariants carried over from the rest of the app:
 *
 *   - **Budgets apply to expenses only.** The loader asks for expense
 *     categories and the actual-spending query filters to `type = 'expense'`,
 *     so income and savings can never appear against a budget.
 *   - **Spending is net of refunds.** The actual figure comes from
 *     `summarizeExpensesByCategory`, the same `NET_AMOUNT_EXPRESSION` the
 *     dashboard uses, so a refund reduces the spending it reverses instead of
 *     being counted as extra.
 */

/** How a category's spending compares with its budget. */
export type BudgetStatus = 'under' | 'near' | 'reached' | 'exceeded';

/** Order used when listing budgeted categories: the most at-risk first. */
const STATUS_ORDER: Record<BudgetStatus, number> = {
  exceeded: 0,
  reached: 1,
  near: 2,
  under: 3,
};

/** One expense category that *has* a budget, ready for display. */
export type CategoryBudgetRow = {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  budgetedMinorUnits: number;
  /** Net of refunds; may be negative when the period was refund-heavy. */
  spentMinorUnits: number;
  /** `budgeted -?' spent`; negative when overspent. */
  remainingMinorUnits: number;
  /** Percentage of the budget used. Never null: a budget is always > 0. */
  percentUsed: number;
  /** Fraction of the progress bar to fill, clamped to 0..1 for drawing. */
  progress: number;
  status: BudgetStatus;
};

/** One expense category with real spending but *no* budget yet. */
export type CategorySpendingRow = {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  /** Net of refunds. Always positive: these are categories with real spending. */
  spentMinorUnits: number;
};

/** Totals across the categories that have a budget this month. */
export type BudgetsTotals = {
  budgetedMinorUnits: number;
  spentMinorUnits: number;
  remainingMinorUnits: number;
};

export type BudgetsData = {
  monthKey: MonthKey;
  /** "October 2026". */
  monthLabel: string;
  /** Inclusive dates the month covers, honouring the start-day setting. */
  range: MonthRange;
  currencySymbol: string;
  /** Threshold that turns "under" into "near", from settings. */
  warningThresholdPercent: number;
  /** Categories with a budget, most at-risk first. */
  rows: CategoryBudgetRow[];
  /** Expense categories with spending but no budget, biggest spender first. */
  unbudgeted: CategorySpendingRow[];
  /** Sums over `rows` only — money with a budget to be measured against. */
  totals: BudgetsTotals;
};

/**
 * Classifies spending against a budget.
 *
 * `exceeded` is strictly over; `reached` is exactly at the limit; `near` is at
 * or past the warning threshold but still under the limit; `under` is
 * everything else. Spending can legitimately be negative (a refund-heavy
 * period), which simply stays `under` — it is never clamped to zero, because
 * "you have more left than you budgeted" is the honest reading.
 */
export function resolveBudgetStatus(
  spentMinorUnits: number,
  budgetedMinorUnits: number,
  warningThresholdPercent: number
): BudgetStatus {
  if (spentMinorUnits > budgetedMinorUnits) {
    return 'exceeded';
  }
  if (spentMinorUnits >= budgetedMinorUnits) {
    return 'reached';
  }

  const percent = percentageOf(spentMinorUnits, budgetedMinorUnits) ?? 0;
  return percent >= warningThresholdPercent ? 'near' : 'under';
}

/** Builds one budgeted row from a category, its budget and its actual spend. */
export function buildCategoryBudgetRow(
  category: Pick<Category, 'id' | 'name' | 'icon'>,
  budgetedMinorUnits: number,
  spentMinorUnits: number,
  warningThresholdPercent: number
): CategoryBudgetRow {
  const percentUsed = percentageOf(spentMinorUnits, budgetedMinorUnits) ?? 0;

  return {
    categoryId: category.id,
    categoryName: category.name,
    categoryIcon: category.icon,
    budgetedMinorUnits,
    spentMinorUnits,
    remainingMinorUnits: budgetedMinorUnits - spentMinorUnits,
    percentUsed,
    progress: Math.min(1, Math.max(0, percentUsed / 100)),
    status: resolveBudgetStatus(spentMinorUnits, budgetedMinorUnits, warningThresholdPercent),
  };
}

/**
 * Turns categories, their budgets and their spending into the two lists the
 * screen shows.
 *
 * Pure on purpose: given the same inputs it always produces the same rows, so
 * the ordering and the "who has no budget" rule can be pinned down in tests.
 *
 * - Only **expense** categories take part. Income and savings categories are
 *   dropped even if a stale budget row somehow pointed at one.
 * - A category with a budget becomes a `row`.
 * - A category with **positive** spending and no budget becomes an
 *   `unbudgeted` entry. Zero net spending (for example a fully refunded
 *   purchase) and negative net spending (refund-only) are not "unplanned
 *   spending", so they are left out.
 */
export function buildBudgetRows(params: {
  categories: readonly Category[];
  budgets: readonly MonthlyBudget[];
  /** Net spending per category id, as returned by the SQL layer. */
  spentByCategory: ReadonlyMap<string, number>;
  thresholdPercent: number;
}): { rows: CategoryBudgetRow[]; unbudgeted: CategorySpendingRow[] } {
  const { categories, budgets, spentByCategory, thresholdPercent } = params;

  const budgetByCategoryId = new Map(
    budgets.map((budget) => [budget.categoryId, budget.budgetedMinorUnits] as const)
  );

  const rows: CategoryBudgetRow[] = [];
  const unbudgeted: CategorySpendingRow[] = [];

  for (const category of categories) {
    if (category.type !== 'expense') {
      continue;
    }

    const spent = spentByCategory.get(category.id) ?? 0;
    const budgeted = budgetByCategoryId.get(category.id);

    if (budgeted !== undefined) {
      rows.push(buildCategoryBudgetRow(category, budgeted, spent, thresholdPercent));
    } else if (spent > 0) {
      unbudgeted.push({
        categoryId: category.id,
        categoryName: category.name,
        categoryIcon: category.icon,
        spentMinorUnits: spent,
      });
    }
  }

  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.percentUsed - a.percentUsed ||
      a.categoryName.localeCompare(b.categoryName)
  );

  unbudgeted.sort(
    (a, b) => b.spentMinorUnits - a.spentMinorUnits || a.categoryName.localeCompare(b.categoryName)
  );

  return { rows, unbudgeted };
}

/** Sums the budgeted rows into the screen's summary card. */
export function buildBudgetsTotals(rows: readonly CategoryBudgetRow[]): BudgetsTotals {
  return rows.reduce<BudgetsTotals>(
    (totals, row) => ({
      budgetedMinorUnits: totals.budgetedMinorUnits + row.budgetedMinorUnits,
      spentMinorUnits: totals.spentMinorUnits + row.spentMinorUnits,
      remainingMinorUnits: totals.remainingMinorUnits + row.remainingMinorUnits,
    }),
    { budgetedMinorUnits: 0, spentMinorUnits: 0, remainingMinorUnits: 0 }
  );
}

/**
 * Validates the amount typed into the budget form.
 *
 * Returns a message for the field, or `null` when the value is usable. A budget
 * must be a real, positive amount: `parseAmountToMinorUnits` already rejects
 * signs, letters and too many decimals, and the schema independently refuses a
 * stored 0.
 */
export function budgetAmountError(input: string): string | null {
  const amount = parseAmountToMinorUnits(input);
  if (amount === null) {
    return 'Enter a valid amount, for example 5000.';
  }
  if (amount <= 0) {
    return 'The budget must be more than zero.';
  }
  return null;
}

/**
 * Loads everything the Budgets screen needs for one financial month.
 *
 * `monthKey` defaults to the current financial month, derived from
 * `periodMonthKey` and the user's `financialMonthStartDay`, so with a start day
 * of 25 the "current" month is the period that began on the 25th, not the
 * calendar month. The date range comes from `monthRange` with the same start
 * day, so what the header says and which transactions are counted can never
 * disagree.
 *
 * Retired categories are loaded as well: a budget or a transaction may still
 * reference one, and hiding it would silently drop real spending.
 */
export async function getBudgetsData(
  db: SQLiteDatabase,
  monthKey?: MonthKey
): Promise<BudgetsData> {
  const settings = await getSettings(db);

  const resolvedMonthKey =
    monthKey && isValidMonthKey(monthKey)
      ? monthKey
      : periodMonthKey(todayIso(), settings.financialMonthStartDay);

  const range = monthRange(resolvedMonthKey, settings.financialMonthStartDay);
  if (!range) {
    // Thrown rather than falling back to "everything": an unknown range would
    // quietly show the wrong spending against the wrong budgets.
    throw new Error('Could not work out the selected financial month.');
  }

  const [categories, budgets, expenseTotals] = await Promise.all([
    listCategories(db, { type: 'expense', includeInactive: true }),
    listBudgetsForMonth(db, resolvedMonthKey),
    summarizeExpensesByCategory(db, { from: range.start, to: range.end }),
  ]);

  const spentByCategory = new Map(
    expenseTotals.map((total) => [total.categoryId, total.netMinorUnits] as const)
  );

  const { rows, unbudgeted } = buildBudgetRows({
    categories,
    budgets,
    spentByCategory,
    thresholdPercent: settings.budgetWarningThresholdPercent,
  });

  return {
    monthKey: resolvedMonthKey,
    monthLabel: formatMonthLabel(resolvedMonthKey),
    range,
    currencySymbol: settings.currencySymbol,
    warningThresholdPercent: settings.budgetWarningThresholdPercent,
    rows,
    unbudgeted,
    totals: buildBudgetsTotals(rows),
  };
}
