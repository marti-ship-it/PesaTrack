import type { SQLiteDatabase } from 'expo-sqlite';

import type { SavingsGoal } from '@/types/models';
import { createId, nowIso } from '@/utils/ids';

/**
 * Reads and writes savings goals.
 *
 * There is deliberately no `contributions` table. A contribution is an ordinary
 * `saving` transaction carrying `savingsGoalId`, so `transactions` stays the
 * single source of truth for money movement and no amount can be counted twice.
 * A goal's balance is therefore always *derived* — its opening balance plus the
 * net of the saving transactions linked to it — and never cached here, so the
 * number on screen cannot drift away from the rows underneath it.
 *
 * A goal is archived rather than deleted. `savings_goal_id` uses
 * `ON DELETE SET NULL`, so a delete would silently detach a goal's whole history
 * and make that money look like it was never saved for anything. Archiving keeps
 * the link, and the history, intact.
 */

/** The row shape as SQLite returns it, kept separate from the domain type. */
type SavingsGoalRow = {
  id: string;
  name: string;
  target_minor_units: number;
  opening_balance_minor_units: number;
  target_date: string | null;
  is_archived: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const SAVINGS_GOAL_COLUMNS = `
  id, name, target_minor_units, opening_balance_minor_units, target_date,
  is_archived, sort_order, created_at, updated_at
`;

function rowToGoal(row: SavingsGoalRow): SavingsGoal {
  return {
    id: row.id,
    name: row.name,
    targetMinorUnits: row.target_minor_units,
    openingBalanceMinorUnits: row.opening_balance_minor_units,
    targetDate: row.target_date,
    isArchived: row.is_archived === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ListSavingsGoalsOptions = {
  /** Include archived goals (needed by the management screen). */
  includeArchived?: boolean;
};

/**
 * Lists savings goals, oldest first.
 *
 * Active-only by default: an archived goal is one the user has finished with, so
 * it must not appear in the "add transaction" picker or in the dashboard card.
 */
export async function listSavingsGoals(
  db: SQLiteDatabase,
  options: ListSavingsGoalsOptions = {}
): Promise<SavingsGoal[]> {
  const whereClause = options.includeArchived ? '' : 'WHERE is_archived = 0';

  const rows = await db.getAllAsync<SavingsGoalRow>(
    `SELECT ${SAVINGS_GOAL_COLUMNS}
     FROM savings_goals
     ${whereClause}
     ORDER BY sort_order ASC, created_at ASC;`
  );

  return rows.map(rowToGoal);
}

/** Returns one goal, or `null` when the id is unknown. */
export async function getSavingsGoalById(
  db: SQLiteDatabase,
  id: string
): Promise<SavingsGoal | null> {
  const row = await db.getFirstAsync<SavingsGoalRow>(
    `SELECT ${SAVINGS_GOAL_COLUMNS} FROM savings_goals WHERE id = ?;`,
    [id]
  );

  return row ? rowToGoal(row) : null;
}

/**
 * The net money paid into each goal, keyed by goal id.
 *
 * A `saving` transaction always carries a direction (`saving_direction` is
 * required for that type by the schema), so "in" adds and "out" subtracts. The
 * result is a plain map so the caller can look a goal up without scanning.
 *
 * Goals with no transactions are simply absent from the map; callers treat a
 * missing key as zero.
 */
export async function contributionsByGoal(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ savings_goal_id: string; contributed: number }>(
    `SELECT
       savings_goal_id,
       SUM(CASE saving_direction WHEN 'in' THEN amount_minor_units ELSE -amount_minor_units END)
         AS contributed
     FROM transactions
     WHERE type = 'saving' AND savings_goal_id IS NOT NULL
     GROUP BY savings_goal_id;`
  );

  return Object.fromEntries(rows.map((row) => [row.savings_goal_id, row.contributed]));
}

/** Everything needed to create a goal. */
export type CreateSavingsGoalInput = {
  name: string;
  /** Positive integer, in minor units. The schema rejects 0. */
  targetMinorUnits: number;
  /** Money already saved before using PesaTrack. Never negative; defaults to 0. */
  openingBalanceMinorUnits?: number;
  /** Optional `YYYY-MM-DD`. */
  targetDate?: string | null;
};

async function nextSortOrder(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ highest: number | null }>(
    'SELECT MAX(sort_order) AS highest FROM savings_goals;'
  );

  return (row?.highest ?? -1) + 1;
}

export async function createSavingsGoal(
  db: SQLiteDatabase,
  input: CreateSavingsGoalInput
): Promise<SavingsGoal> {
  const id = createId();
  const timestamp = nowIso();

  await db.runAsync(
    `INSERT INTO savings_goals (
       id, name, target_minor_units, opening_balance_minor_units, target_date,
       is_archived, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?);`,
    [
      id,
      input.name.trim(),
      input.targetMinorUnits,
      input.openingBalanceMinorUnits ?? 0,
      input.targetDate ?? null,
      await nextSortOrder(db),
      timestamp,
      timestamp,
    ]
  );

  const created = await getSavingsGoalById(db, id);
  if (!created) {
    throw new Error('The savings goal could not be created.');
  }
  return created;
}

/** Editable fields. `isArchived` is changed through `setSavingsGoalArchived`. */
export type UpdateSavingsGoalInput = {
  name?: string;
  targetMinorUnits?: number;
  openingBalanceMinorUnits?: number;
  targetDate?: string | null;
};

/**
 * Updates a goal.
 *
 * The target may be edited freely: lowering it is a legitimate way to say "I only
 * need this much", and nothing else in the database depends on it. Contributions
 * are untouched, because they are transactions rather than part of the goal row.
 */
export async function updateSavingsGoal(
  db: SQLiteDatabase,
  id: string,
  patch: UpdateSavingsGoalInput
): Promise<SavingsGoal> {
  const existing = await getSavingsGoalById(db, id);
  if (!existing) {
    throw new Error('That savings goal no longer exists.');
  }

  await db.runAsync(
    `UPDATE savings_goals
       SET name = ?,
           target_minor_units = ?,
           opening_balance_minor_units = ?,
           target_date = ?,
           updated_at = ?
     WHERE id = ?;`,
    [
      patch.name !== undefined ? patch.name.trim() : existing.name,
      patch.targetMinorUnits ?? existing.targetMinorUnits,
      patch.openingBalanceMinorUnits ?? existing.openingBalanceMinorUnits,
      patch.targetDate !== undefined ? patch.targetDate : existing.targetDate,
      nowIso(),
      id,
    ]
  );

  const updated = await getSavingsGoalById(db, id);
  if (!updated) {
    throw new Error('The savings goal could not be updated.');
  }
  return updated;
}

/**
 * Archives or restores a goal.
 *
 * Archived goals keep every linked transaction; they are only hidden from the
 * picker and the dashboard. Nothing here can fail for the reason retiring a
 * category can: a transaction may always be recorded without a goal at all.
 */
export async function setSavingsGoalArchived(
  db: SQLiteDatabase,
  id: string,
  isArchived: boolean
): Promise<SavingsGoal> {
  const existing = await getSavingsGoalById(db, id);
  if (!existing) {
    throw new Error('That savings goal no longer exists.');
  }

  await db.runAsync('UPDATE savings_goals SET is_archived = ?, updated_at = ? WHERE id = ?;', [
    isArchived ? 1 : 0,
    nowIso(),
    id,
  ]);

  const updated = await getSavingsGoalById(db, id);
  if (!updated) {
    throw new Error('The savings goal could not be updated.');
  }
  return updated;
}

/**
 * The net amount paid into one goal, or `0` when it has no transactions.
 *
 * Used by the contribution flow to refuse a withdrawal larger than the money
 * actually held, and by the goal list to show a balance.
 */
export async function contributedMinorUnitsForGoal(
  db: SQLiteDatabase,
  goalId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ contributed: number | null }>(
    `SELECT
       SUM(CASE saving_direction WHEN 'in' THEN amount_minor_units ELSE -amount_minor_units END)
         AS contributed
     FROM transactions
     WHERE type = 'saving' AND savings_goal_id = ?;`,
    [goalId]
  );

  return row?.contributed ?? 0;
}
