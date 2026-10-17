/**
 * Verifies the backup repository against a real SQLite engine — the same SQL the
 * phone runs.
 *
 * Three things are pinned here that the pure tests in `services/backup.ts`
 * cannot reach:
 *
 *   1. **A backup rebuilds an identical database.** Read every table out of one
 *      database, write it into another, and read the same rows back.
 *   2. **A restore replaces, rather than merges.** Rows already on the device
 *      that the backup does not contain are gone afterwards.
 *   3. **A restore is all-or-nothing.** A backup that breaks a constraint leaves
 *      the device exactly as it was, never half-written.
 *
 * It uses `node:sqlite` like `schema.test.ts` and `savings-goals.test.ts`, so no
 * emulator or native module is needed — the only bridge is a thin adapter
 * exposing the async methods the repository calls.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

import type { BackupRow, BackupTables } from '@/db/schema';

import { readAllTables, readCsvExportData, replaceAllTables } from '../repositories/backup';
import { SCHEMA_V1 } from '../schema';

type SqlValue = string | number | null;

const TIMESTAMP = '2026-10-15T10:00:00.000Z';

type Harness = {
  handle: DatabaseSync;
  db: SQLiteDatabase;
};

/** A fresh in-memory database with the real schema applied. */
function createHarness(): Harness {
  const handle = new DatabaseSync(':memory:');
  handle.exec('PRAGMA foreign_keys = ON;');
  handle.exec(SCHEMA_V1);

  const db = {
    getFirstAsync: async <T>(sql: string, params: SqlValue[] = []): Promise<T | null> =>
      ((handle.prepare(sql).get(...params) ?? null) as unknown as T | null),
    getAllAsync: async <T>(sql: string, params: SqlValue[] = []): Promise<T[]> =>
      (handle.prepare(sql).all(...params) as unknown as T[]),
    runAsync: async (sql: string, params: SqlValue[] = []) => {
      const info = handle.prepare(sql).run(...params);
      return { changes: Number(info.changes), lastInsertRowId: Number(info.lastInsertRowid) };
    },
    execAsync: async (sql: string) => {
      handle.exec(sql);
    },
    // Mirrors expo-sqlite: the whole task runs in one transaction, and a failure
    // anywhere — including the commit itself, where deferred foreign keys are
    // finally checked — rolls everything back.
    withTransactionAsync: async (task: () => Promise<void>) => {
      handle.exec('BEGIN');
      try {
        await task();
        handle.exec('COMMIT');
      } catch (error) {
        try {
          handle.exec('ROLLBACK');
        } catch {
          // Already rolled back; the original error is the one worth reporting.
        }
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;

  return { handle, db };
}

/** Writes one representative row into every table, including a refund and a goal. */
function seed(handle: DatabaseSync): void {
  handle
    .prepare(
      `INSERT INTO categories (id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, 1, 0, ?);`
    )
    .run('cat-food', 'Food', 'expense', TIMESTAMP);
  handle
    .prepare(
      `INSERT INTO categories (id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, 1, 1, ?);`
    )
    .run('cat-savings', 'Savings', 'saving', TIMESTAMP);

  handle
    .prepare(
      `INSERT INTO payment_methods (id, name, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, 1, 1, 0, ?);`
    )
    .run('pm-1', 'M-Pesa', TIMESTAMP);

  handle
    .prepare(
      `INSERT INTO savings_goals (id, name, target_minor_units, opening_balance_minor_units, target_date, is_archived, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?);`
    )
    .run('goal-1', 'Emergency', 5000000, 2000, '2026-12-31', TIMESTAMP, TIMESTAMP);

  const insertTransaction = handle.prepare(
    `INSERT INTO transactions (id, type, amount_minor_units, date, description, notes, category_id, need_want, payment_method_id, saving_direction, savings_goal_id, refund_of_transaction_id, created_at, updated_at)
     VALUES (?, ?, ?, '2026-10-15', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?);`
  );

  insertTransaction.run(
    'tx-expense', 'expense', 50000, 'Lunch', 'cat-food', 'need', 'pm-1', null, null, null,
    TIMESTAMP, TIMESTAMP
  );
  insertTransaction.run(
    'tx-refund', 'expense', 10000, 'Refund', 'cat-food', null, 'pm-1', null, null, 'tx-expense',
    TIMESTAMP, TIMESTAMP
  );
  insertTransaction.run(
    'tx-saving', 'saving', 100000, 'Saved', 'cat-savings', null, null, 'in', 'goal-1', null,
    TIMESTAMP, TIMESTAMP
  );

  handle
    .prepare(
      `INSERT INTO monthly_budgets (id, month_key, category_id, budgeted_minor_units, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?);`
    )
    .run('bud-1', '2026-10', 'cat-food', 200000, TIMESTAMP, TIMESTAMP);
  handle
    .prepare(
      `INSERT INTO monthly_budget_totals (id, month_key, budgeted_minor_units, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?);`
    )
    .run('total-1', '2026-10', 500000, TIMESTAMP, TIMESTAMP);
  handle
    .prepare(
      `INSERT INTO obligations (id, name, amount_minor_units, due_date, is_paid, paid_transaction_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?);`
    )
    .run('ob-1', 'Rent', 30000, '2026-11-01', TIMESTAMP, TIMESTAMP);
  handle
    .prepare(
      `INSERT INTO settings (
         id, display_name, currency_code, currency_symbol, financial_month_start_day,
         theme_preference, budget_warning_threshold_percent, default_transaction_sort,
         starting_balance_minor_units, savings_opening_balance_minor_units,
         onboarding_completed, created_at, updated_at
       ) VALUES (1, ?, 'KES', 'KSh', 25, 'dark', 70, 'oldest', 5000, 1000, 1, ?, ?);`
    )
    .run('Amina', TIMESTAMP, TIMESTAMP);
}

describe('readAllTables', () => {
  it('returns every row of every table', async () => {
    const { handle, db } = createHarness();
    seed(handle);

    const tables = await readAllTables(db);

    expect(tables.transactions).toHaveLength(3);
    expect(tables.categories).toHaveLength(2);
    expect(tables.savings_goals).toHaveLength(1);
    expect(tables.monthly_budgets).toHaveLength(1);
    expect(tables.monthly_budget_totals).toHaveLength(1);
    expect(tables.obligations).toHaveLength(1);
    expect(tables.settings).toHaveLength(1);
  });
});

describe('replaceAllTables', () => {
  it('rebuilds an identical database from a backup', async () => {
    const source = createHarness();
    seed(source.handle);
    const tables = await readAllTables(source.db);

    const target = createHarness();
    await replaceAllTables(target.db, tables);

    await expect(readAllTables(target.db)).resolves.toEqual(tables);
  });

  it('clears rows the backup does not contain', async () => {
    const source = createHarness();
    seed(source.handle);
    const tables = await readAllTables(source.db);

    const target = createHarness();
    target.handle
      .prepare(
        `INSERT INTO categories (id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, 9, ?);`
      )
      .run('cat-extra', 'Extra', 'expense', TIMESTAMP);

    await replaceAllTables(target.db, tables);

    const restored = await readAllTables(target.db);
    expect((restored.categories ?? []).map((row) => row.id)).not.toContain('cat-extra');
  });

  it('restores a refund even when it appears before the expense it reverses', async () => {
    const source = createHarness();
    seed(source.handle);
    const tables = await readAllTables(source.db);

    // Foreign keys are checked at commit, so row order in the file cannot matter.
    const reversed: BackupTables = {
      ...tables,
      transactions: [...(tables.transactions ?? [])].reverse(),
    };

    const target = createHarness();
    await expect(replaceAllTables(target.db, reversed)).resolves.toBeUndefined();
  });

  it('leaves the database untouched when the backup breaks a constraint', async () => {
    const source = createHarness();
    seed(source.handle);
    const tables = await readAllTables(source.db);

    const broken: BackupRow = {
      id: 'tx-orphan',
      type: 'expense',
      amount_minor_units: 100,
      date: '2026-10-15',
      description: 'No such category',
      notes: null,
      category_id: 'cat-missing',
      need_want: null,
      payment_method_id: null,
      saving_direction: null,
      savings_goal_id: null,
      refund_of_transaction_id: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    };

    const target = createHarness();
    seed(target.handle);
    const before = await readAllTables(target.db);

    await expect(
      replaceAllTables(target.db, {
        ...tables,
        transactions: [...(tables.transactions ?? []), broken],
      })
    ).rejects.toThrow();

    // Nothing was half-applied: the target still holds exactly what it did.
    await expect(readAllTables(target.db)).resolves.toEqual(before);
  });
});

describe('readCsvExportData', () => {
  it('resolves names for the CSV, including retired payment methods', async () => {
    const { handle, db } = createHarness();
    seed(handle);

    // Retiring a label must not hide it from history.
    handle.prepare(`UPDATE payment_methods SET is_active = 0 WHERE id = 'pm-1';`).run();

    const data = await readCsvExportData(db);

    expect(data.currencyCode).toBe('KES');
    expect(data.categoriesById['cat-food']).toBe('Food');
    expect(data.categoriesById['cat-savings']).toBe('Savings');
    expect(data.paymentMethodsById['pm-1']).toBe('M-Pesa');
    expect(data.savingsGoalsById['goal-1']).toBe('Emergency');
    expect(data.transactions.map((transaction) => transaction.id).sort()).toEqual([
      'tx-expense',
      'tx-refund',
      'tx-saving',
    ]);
  });
});
