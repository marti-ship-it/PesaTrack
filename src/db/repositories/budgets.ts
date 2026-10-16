import type { SQLiteDatabase } from 'expo-sqlite';

import type { MonthlyBudget } from '@/types/models';
import type { MonthKey } from '@/utils/dates';
import { createId, nowIso } from '@/utils/ids';

/**
 * Reads and writes per-category monthly budgets.
 *
 * The rules the schema already enforces, and that this layer keeps readable:
 *
 *   1. **One budget per category per month.** The unique index
 *      `idx_monthly_budgets_month_category` backs this, and `upsertBudget`
 *      uses `ON CONFLICT` so "set a budget" is a single statement whether the
 *      row exists yet or not.
 *   2. **A budget is never zero.** The schema requires
 *      `budgeted_minor_units > 0`; a missing row *is* "No budget set". Clearing
 *      a budget therefore deletes the row rather than storing 0.
 *   3. **`month_key` names the month the financial period begins in**, matching
 *      `MonthKey` and `monthRange` in `utils/dates`. This layer stores it as
 *      given and never reinterprets it.
 *
 * There is deliberately no code here for `monthly_budget_totals`: the overall
 * monthly limit is out of scope for this milestone, and its table is left
 * exactly as the schema defines it.
 */

/** The row shape as SQLite returns it, kept separate from the domain type. */
type MonthlyBudgetRow = {
  id: string;
  month_key: string;
  category_id: string;
  budgeted_minor_units: number;
  created_at: string;
  updated_at: string;
};

const BUDGET_COLUMNS = `
  id, month_key, category_id, budgeted_minor_units, created_at, updated_at
`;

function rowToBudget(row: MonthlyBudgetRow): MonthlyBudget {
  return {
    id: row.id,
    monthKey: row.month_key,
    categoryId: row.category_id,
    budgetedMinorUnits: row.budgeted_minor_units,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists every category budget set for one financial month.
 *
 * Returns `[]` (never `null`) when none are set, so a caller can map over the
 * result without a guard. Ordering is stable (oldest first) purely so the
 * result is deterministic for tests; the service re-sorts for display.
 */
export async function listBudgetsForMonth(
  db: SQLiteDatabase,
  monthKey: MonthKey
): Promise<MonthlyBudget[]> {
  const rows = await db.getAllAsync<MonthlyBudgetRow>(
    `SELECT ${BUDGET_COLUMNS}
     FROM monthly_budgets
     WHERE month_key = ?
     ORDER BY created_at ASC;`,
    [monthKey]
  );

  return rows.map(rowToBudget);
}

/** Returns one category's budget for a month, or `null` when none is set. */
export async function getBudget(
  db: SQLiteDatabase,
  monthKey: MonthKey,
  categoryId: string
): Promise<MonthlyBudget | null> {
  const row = await db.getFirstAsync<MonthlyBudgetRow>(
    `SELECT ${BUDGET_COLUMNS}
     FROM monthly_budgets
     WHERE month_key = ? AND category_id = ?;`,
    [monthKey, categoryId]
  );

  return row ? rowToBudget(row) : null;
}

/** Everything needed to set (create or replace) a category budget. */
export type UpsertBudgetInput = {
  monthKey: MonthKey;
  categoryId: string;
  /** Positive integer, in minor units. The schema rejects 0. */
  budgetedMinorUnits: number;
};

/**
 * Creates or replaces a category's budget for a month.
 *
 * The `ON CONFLICT (month_key, category_id)` upsert means the same call handles
 * "set a budget for the first time" and "change an existing one", so the caller
 * never has to ask whether a row is already there. `created_at` is preserved on
 * update; only `budgeted_minor_units` and `updated_at` change. The stored row is
 * returned so the caller can navigate away knowing the write succeeded.
 */
export async function upsertBudget(
  db: SQLiteDatabase,
  input: UpsertBudgetInput
): Promise<MonthlyBudget> {
  const timestamp = nowIso();

  await db.runAsync(
    `INSERT INTO monthly_budgets (
       id, month_key, category_id, budgeted_minor_units, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (month_key, category_id) DO UPDATE SET
       budgeted_minor_units = excluded.budgeted_minor_units,
       updated_at = excluded.updated_at;`,
    [
      createId(),
      input.monthKey,
      input.categoryId,
      input.budgetedMinorUnits,
      timestamp,
      timestamp,
    ]
  );

  const saved = await getBudget(db, input.monthKey, input.categoryId);
  if (!saved) {
    throw new Error('The budget could not be saved.');
  }
  return saved;
}

/**
 * Clears a category's budget for a month.
 *
 * Deleting the row is what "no budget set" means; writing 0 would violate the
 * schema's `budgeted_minor_units > 0` check. Deleting a budget that is not there
 * is a harmless no-op.
 */
export async function deleteBudget(
  db: SQLiteDatabase,
  monthKey: MonthKey,
  categoryId: string
): Promise<void> {
  await db.runAsync('DELETE FROM monthly_budgets WHERE month_key = ? AND category_id = ?;', [
    monthKey,
    categoryId,
  ]);
}
