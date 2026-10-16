/**
 * Verifies the dashboard's aggregate SQL against a real SQLite engine — the
 * same query the phone runs.
 *
 * The service tests pin the arithmetic; these pin the *data* the arithmetic is
 * built from: that refunds net against expenses on the refund's own date, that
 * savings never leak into income or expenses, that date ranges are inclusive
 * and month boundaries land on the right days, and that deleted rows are
 * simply gone. They use `node:sqlite` like `schema.test.ts`, so no emulator or
 * native module is needed — the only bridge is a thin adapter exposing the
 * async methods the repository calls.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

import { resolveDashboardRange } from '@/services/dashboard';
import type { MonthRange } from '@/utils/dates';

import { deleteTransaction, summarizeTransactions } from '../repositories/transactions';
import { SCHEMA_V1 } from '../schema';

type SqlValue = string | number | null;

const TIMESTAMP = '2026-10-15T10:00:00.000Z';

const ZERO_TOTALS = {
  incomeMinorUnits: 0,
  expensesNetMinorUnits: 0,
  savingsInMinorUnits: 0,
  savingsOutMinorUnits: 0,
};

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
    runAsync: async (sql: string, params: SqlValue[] = []) => {
      const info = handle.prepare(sql).run(...params);
      return { changes: Number(info.changes), lastInsertRowId: Number(info.lastInsertRowid) };
    },
  } as unknown as SQLiteDatabase;

  return { handle, db };
}

/** Returns a category id for the type, creating one on first use. */
function categoryIdFor(handle: DatabaseSync, type: string): string {
  const existing = handle
    .prepare('SELECT id FROM categories WHERE type = ? ORDER BY sort_order LIMIT 1;')
    .get(type) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const id = `cat-test-${type}`;
  handle
    .prepare(
      `INSERT INTO categories (id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, 1, 0, ?);`
    )
    .run(id, `Test ${type} category`, type, TIMESTAMP);
  return id;
}

type TransactionFixture = {
  id: string;
  type: 'income' | 'expense' | 'saving';
  amountMinorUnits: number;
  date: string;
  description?: string;
  savingDirection?: 'in' | 'out';
  refundOf?: string;
};

function insertTransaction(handle: DatabaseSync, fixture: TransactionFixture): void {
  handle
    .prepare(
      `INSERT INTO transactions (
         id, type, amount_minor_units, date, description, notes, category_id, need_want,
         payment_method_id, saving_direction, savings_goal_id, refund_of_transaction_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?, ?);`
    )
    .run(
      fixture.id,
      fixture.type,
      fixture.amountMinorUnits,
      fixture.date,
      fixture.description ?? 'Test row',
      categoryIdFor(handle, fixture.type),
      fixture.type === 'expense' ? 'need' : null,
      fixture.savingDirection ?? null,
      fixture.refundOf ?? null,
      TIMESTAMP,
      TIMESTAMP
    );
}

/** Narrows the nullable range returned by `resolveDashboardRange`. */
function requireRange(range: MonthRange | null): MonthRange {
  if (!range) {
    throw new Error('Expected a financial-month range.');
  }
  return range;
}

describe('summarizeTransactions', () => {
  it('returns zeros — never null — for an empty database', async () => {
    const { db } = createHarness();

    await expect(summarizeTransactions(db)).resolves.toEqual(ZERO_TOTALS);
    await expect(
      summarizeTransactions(db, { from: '2026-10-01', to: '2026-10-31' })
    ).resolves.toEqual(ZERO_TOTALS);
  });

  it('totals income only', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'in-1',
      type: 'income',
      amountMinorUnits: 500000,
      date: '2026-10-05',
    });
    insertTransaction(handle, {
      id: 'in-2',
      type: 'income',
      amountMinorUnits: 250000,
      date: '2026-10-20',
    });

    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      incomeMinorUnits: 750000,
    });
  });

  it('nets a partial refund against expenses and never counts it as income', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'ex-1',
      type: 'expense',
      amountMinorUnits: 140000,
      date: '2026-10-10',
    });
    insertTransaction(handle, {
      id: 'rf-1',
      type: 'expense',
      amountMinorUnits: 80000,
      date: '2026-10-12',
      refundOf: 'ex-1',
    });

    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      expensesNetMinorUnits: 60000, // 140000 − 80000; income stays 0.
    });
  });

  it('nets a fully refunded expense down to zero', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'ex-2',
      type: 'expense',
      amountMinorUnits: 25000,
      date: '2026-10-10',
    });
    insertTransaction(handle, {
      id: 'rf-2',
      type: 'expense',
      amountMinorUnits: 25000,
      date: '2026-10-11',
      refundOf: 'ex-2',
    });

    await expect(summarizeTransactions(db)).resolves.toEqual(ZERO_TOTALS);
  });

  it('keeps savings out of income and expenses', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'mixed-in',
      type: 'income',
      amountMinorUnits: 500000,
      date: '2026-10-01',
    });
    insertTransaction(handle, {
      id: 'mixed-ex',
      type: 'expense',
      amountMinorUnits: 123000,
      date: '2026-10-02',
    });
    insertTransaction(handle, {
      id: 'mixed-save-in',
      type: 'saving',
      amountMinorUnits: 50000,
      date: '2026-10-03',
      savingDirection: 'in',
    });
    insertTransaction(handle, {
      id: 'mixed-save-out',
      type: 'saving',
      amountMinorUnits: 10000,
      date: '2026-10-04',
      savingDirection: 'out',
    });

    await expect(summarizeTransactions(db)).resolves.toEqual({
      incomeMinorUnits: 500000, // exactly — the 50000 saving did not leak in
      expensesNetMinorUnits: 123000, // and did not leak in here either
      savingsInMinorUnits: 50000,
      savingsOutMinorUnits: 10000,
    });
  });

  it('includes both ends of the range and nothing outside it', async () => {
    const { handle, db } = createHarness();
    const incomeOn = (id: string, date: string, amountMinorUnits: number) =>
      insertTransaction(handle, { id, type: 'income', amountMinorUnits, date });

    incomeOn('before', '2026-09-30', 100000);
    incomeOn('on-start', '2026-10-01', 200000);
    incomeOn('on-end', '2026-10-31', 400000);
    incomeOn('after', '2026-11-01', 800000);

    await expect(
      summarizeTransactions(db, { from: '2026-10-01', to: '2026-10-31' })
    ).resolves.toEqual({ ...ZERO_TOTALS, incomeMinorUnits: 600000 });

    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      incomeMinorUnits: 1500000,
    });
  });

  it('nets a refund in the period the refund is dated in', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'ex-3',
      type: 'expense',
      amountMinorUnits: 90000,
      date: '2026-10-10',
    });
    insertTransaction(handle, {
      id: 'rf-3',
      type: 'expense',
      amountMinorUnits: 40000,
      date: '2026-11-05',
      refundOf: 'ex-3',
    });

    // October sees the full spend — the refund has not happened yet.
    await expect(
      summarizeTransactions(db, { from: '2026-10-01', to: '2026-10-31' })
    ).resolves.toEqual({ ...ZERO_TOTALS, expensesNetMinorUnits: 90000 });

    // November sees only the money coming back.
    await expect(
      summarizeTransactions(db, { from: '2026-11-01', to: '2026-11-30' })
    ).resolves.toEqual({ ...ZERO_TOTALS, expensesNetMinorUnits: -40000 });

    // All time nets the pair.
    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      expensesNetMinorUnits: 50000,
    });
  });

  it('honours financial-month boundaries resolved from the start day', async () => {
    const { handle, db } = createHarness();
    const range = requireRange(resolveDashboardRange('financial-month', 25, '2026-10-16'));
    expect(range).toEqual({ start: '2026-09-25', end: '2026-10-24' });

    const incomeOn = (id: string, date: string, amountMinorUnits: number) =>
      insertTransaction(handle, { id, type: 'income', amountMinorUnits, date });

    incomeOn('day-before-start', '2026-09-24', 10000); // previous period
    incomeOn('on-period-start', '2026-09-25', 20000); // first day, included
    incomeOn('on-period-end', '2026-10-24', 40000); // last day, included
    incomeOn('day-after-end', '2026-10-25', 80000); // next period

    await expect(
      summarizeTransactions(db, { from: range.start, to: range.end })
    ).resolves.toEqual({
      ...ZERO_TOTALS,
      incomeMinorUnits: 60000,
    });
    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      incomeMinorUnits: 150000,
    });
  });

  it('drops a deleted transaction from every total', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'ex-keep',
      type: 'expense',
      amountMinorUnits: 90000,
      date: '2026-10-10',
    });
    insertTransaction(handle, {
      id: 'ex-drop',
      type: 'expense',
      amountMinorUnits: 50000,
      date: '2026-10-11',
    });

    await deleteTransaction(db, 'ex-drop');

    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      expensesNetMinorUnits: 90000,
    });
  });

  it('refuses to delete an expense that has a refund against it', async () => {
    const { handle, db } = createHarness();
    insertTransaction(handle, {
      id: 'ex-4',
      type: 'expense',
      amountMinorUnits: 30000,
      date: '2026-10-10',
    });
    insertTransaction(handle, {
      id: 'rf-4',
      type: 'expense',
      amountMinorUnits: 10000,
      date: '2026-10-12',
      refundOf: 'ex-4',
    });

    // The schema's ON DELETE RESTRICT blocks it, so the refund can never be
    // left reversing nothing.
    await expect(deleteTransaction(db, 'ex-4')).rejects.toThrow();

    await expect(summarizeTransactions(db)).resolves.toEqual({
      ...ZERO_TOTALS,
      expensesNetMinorUnits: 20000, // both rows still present
    });
  });
});
