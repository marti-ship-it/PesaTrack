/**
 * Verifies the budgets repository and the Budgets screen's data against a real
 * SQLite engine - the same SQL the phone runs.
 *
 * The service tests pin the arithmetic; these pin the *data* the arithmetic is
 * built from: that a budget can be created and replaced, that clearing deletes
 * the row, that spending is net of refunds and scoped to the right financial
 * month, and that income and savings never leak into a budget. They use
 * `node:sqlite` like `schema.test.ts`, so no emulator or native module is
 * needed - the only bridge is a thin adapter exposing the async methods the
 * repositories call.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

import { getBudgetsData } from '@/services/budgets';
import { addDays, monthRange, periodMonthKey, todayIso, type MonthRange } from '@/utils/dates';

import {
  deleteBudget,
  getBudget,
  listBudgetsForMonth,
  upsertBudget,
} from '../repositories/budgets';
import { updateSettings } from '../repositories/settings';
import { summarizeExpensesByCategory, summarizeTransactions } from '../repositories/transactions';
import { SCHEMA_V1 } from '../schema';

// `upsertBudget` generates ids through `expo-crypto`. Without the native module
// `randomUUID` yields nothing bindable, so the repository's INSERT would fail on
// parameter 1 with a driver error rather than a useful message.
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `test-uuid-${(counter += 1)}`,
  };
});

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
  } as unknown as SQLiteDatabase;

  return { handle, db };
}

function insertCategory(
  handle: DatabaseSync,
  options: { id: string; name: string; type?: string; icon?: string | null }
): void {
  handle
    .prepare(
      `INSERT INTO categories (
         id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at
       ) VALUES (?, ?, ?, ?, NULL, 0, 1, 0, ?);`
    )
    .run(
      options.id,
      options.name,
      options.type ?? 'expense',
      options.icon ?? null,
      TIMESTAMP
    );
}

type TransactionFixture = {
  id: string;
  type: 'income' | 'expense' | 'saving';
  amountMinorUnits: number;
  date: string;
  categoryId: string;
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
      fixture.categoryId,
      fixture.type === 'expense' ? 'need' : null,
      fixture.savingDirection ?? null,
      fixture.refundOf ?? null,
      TIMESTAMP,
      TIMESTAMP
    );
}

/** Narrows the nullable range returned by `monthRange`. */
function requireRange(range: MonthRange | null): MonthRange {
  if (!range) {
    throw new Error('Expected a month range.');
  }
  return range;
}

describe('listBudgetsForMonth', () => {
  it('returns an empty list, never null, when no budget is set', async () => {
    const { db } = createHarness();

    await expect(listBudgetsForMonth(db, '2026-10')).resolves.toEqual([]);
  });

  it('returns only the budgets belonging to the requested month', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-rent', name: 'Rent' });

    await upsertBudget(db, { monthKey: '2026-10', categoryId: 'cat-food', budgetedMinorUnits: 10000 });
    await upsertBudget(db, { monthKey: '2026-09', categoryId: 'cat-food', budgetedMinorUnits: 20000 });
    await upsertBudget(db, { monthKey: '2026-10', categoryId: 'cat-rent', budgetedMinorUnits: 30000 });

    const october = await listBudgetsForMonth(db, '2026-10');

    expect(october).toHaveLength(2);
    expect(october.map((b) => b.categoryId).sort()).toEqual(['cat-food', 'cat-rent']);
    expect(october.every((b) => b.monthKey === '2026-10')).toBe(true);
  });
});

describe('upsertBudget', () => {
  it('creates a budget on first use', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    const saved = await upsertBudget(db, {
      monthKey: '2026-10',
      categoryId: 'cat-food',
      budgetedMinorUnits: 15000,
    });

    expect(saved.monthKey).toBe('2026-10');
    expect(saved.categoryId).toBe('cat-food');
    expect(saved.budgetedMinorUnits).toBe(15000);
  });

  it('replaces an existing budget instead of creating a second row', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    const first = await upsertBudget(db, {
      monthKey: '2026-10',
      categoryId: 'cat-food',
      budgetedMinorUnits: 10000,
    });
    const second = await upsertBudget(db, {
      monthKey: '2026-10',
      categoryId: 'cat-food',
      budgetedMinorUnits: 12500,
    });

    // Same row updated in place, not a second one; the unique
    // (month_key, category_id) index is the backstop behind the upsert.
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.budgetedMinorUnits).toBe(12500);

    const rows = await listBudgetsForMonth(db, '2026-10');
    expect(rows).toHaveLength(1);
    expect(rows[0].budgetedMinorUnits).toBe(12500);
  });

  it('refuses a zero budget, because a missing row means "no budget set"', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    await expect(
      upsertBudget(db, { monthKey: '2026-10', categoryId: 'cat-food', budgetedMinorUnits: 0 })
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe('deleteBudget', () => {
  it('removes the row so the category is back to "no budget set"', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    await upsertBudget(db, { monthKey: '2026-10', categoryId: 'cat-food', budgetedMinorUnits: 5000 });
    await deleteBudget(db, '2026-10', 'cat-food');

    await expect(getBudget(db, '2026-10', 'cat-food')).resolves.toBeNull();
    await expect(listBudgetsForMonth(db, '2026-10')).resolves.toEqual([]);
  });

  it('is a harmless no-op when nothing is there to clear', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    await expect(deleteBudget(db, '2026-10', 'cat-food')).resolves.toBeUndefined();
  });
});

describe('summarizeExpensesByCategory', () => {
  it('nets a refund against the expense it reverses, per category', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    insertTransaction(handle, {
      id: 'ex-1',
      type: 'expense',
      amountMinorUnits: 100000,
      date: '2026-10-10',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'rf-1',
      type: 'expense',
      amountMinorUnits: 40000,
      date: '2026-10-12',
      categoryId: 'cat-food',
      refundOf: 'ex-1',
    });

    await expect(summarizeExpensesByCategory(db)).resolves.toEqual([
      { categoryId: 'cat-food', netMinorUnits: 60000 },
    ]);
  });

  it('never lets income or savings reach a budget', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-salary', name: 'Salary', type: 'income' });
    insertCategory(handle, { id: 'cat-savings', name: 'Savings', type: 'saving' });

    insertTransaction(handle, {
      id: 'ex-1',
      type: 'expense',
      amountMinorUnits: 50000,
      date: '2026-10-10',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'in-1',
      type: 'income',
      amountMinorUnits: 900000,
      date: '2026-10-10',
      categoryId: 'cat-salary',
    });
    insertTransaction(handle, {
      id: 'sv-1',
      type: 'saving',
      amountMinorUnits: 800000,
      date: '2026-10-10',
      categoryId: 'cat-savings',
      savingDirection: 'in',
    });

    await expect(summarizeExpensesByCategory(db)).resolves.toEqual([
      { categoryId: 'cat-food', netMinorUnits: 50000 },
    ]);
  });

  it('reports a refund-only period as negative rather than clamping it', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    // The original expense was recorded in a previous month; only the refund
    // falls inside this one, so the category legitimately shows money coming
    // back rather than spending. Clamping this to 0 would hide that.
    insertTransaction(handle, {
      id: 'ex-1',
      type: 'expense',
      amountMinorUnits: 30000,
      date: '2026-09-28',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'rf-1',
      type: 'expense',
      amountMinorUnits: 30000,
      date: '2026-10-11',
      categoryId: 'cat-food',
      refundOf: 'ex-1',
      description: 'Refund',
    });

    await expect(
      summarizeExpensesByCategory(db, { from: '2026-10-01', to: '2026-10-31' })
    ).resolves.toEqual([{ categoryId: 'cat-food', netMinorUnits: -30000 }]);
  });

  it('adds the same as the overall net expense total for the same range', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-transport', name: 'Transport' });
    insertCategory(handle, { id: 'cat-salary', name: 'Salary', type: 'income' });
    insertCategory(handle, { id: 'cat-savings', name: 'Savings', type: 'saving' });

    insertTransaction(handle, { id: 'ex-1', type: 'expense', amountMinorUnits: 100000, date: '2026-10-10', categoryId: 'cat-food' });
    insertTransaction(handle, { id: 'rf-1', type: 'expense', amountMinorUnits: 40000, date: '2026-10-12', categoryId: 'cat-food', refundOf: 'ex-1' });
    insertTransaction(handle, { id: 'ex-2', type: 'expense', amountMinorUnits: 25000, date: '2026-10-14', categoryId: 'cat-transport' });
    insertTransaction(handle, { id: 'in-1', type: 'income', amountMinorUnits: 500000, date: '2026-10-10', categoryId: 'cat-salary' });
    insertTransaction(handle, { id: 'sv-1', type: 'saving', amountMinorUnits: 60000, date: '2026-10-10', categoryId: 'cat-savings', savingDirection: 'in' });

    const totals = await summarizeTransactions(db);
    const perCategory = await summarizeExpensesByCategory(db);

    const sum = perCategory.reduce((total, entry) => total + entry.netMinorUnits, 0);

    // One correct total, counted once per category: no double counting.
    expect(sum).toBe(totals.expensesNetMinorUnits);
    expect(sum).toBe(85000);
  });
});

describe('getBudgetsData', () => {
  it('defaults to the current financial month and counts only that range', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    const today = todayIso();
    const monthKey = periodMonthKey(today, 1);
    const range = requireRange(monthRange(monthKey, 1));

    insertTransaction(handle, {
      id: 'ex-in',
      type: 'expense',
      amountMinorUnits: 50000,
      date: range.start,
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'ex-out',
      type: 'expense',
      amountMinorUnits: 70000,
      date: addDays(range.start, -1),
      categoryId: 'cat-food',
    });

    await upsertBudget(db, { monthKey, categoryId: 'cat-food', budgetedMinorUnits: 100000 });

    const data = await getBudgetsData(db);

    expect(data.monthKey).toBe(monthKey);
    expect(data.rows).toHaveLength(1);
    // The transaction dated before the period start is excluded.
    expect(data.rows[0].spentMinorUnits).toBe(50000);
    expect(data.totals.budgetedMinorUnits).toBe(100000);
  });

  it('honours a custom financial month start day', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });

    await updateSettings(db, { financialMonthStartDay: 25 });

    const today = todayIso();
    const monthKey = periodMonthKey(today, 25);
    const range = requireRange(monthRange(monthKey, 25));

    // Just inside and just outside the period, so the boundary is visible.
    insertTransaction(handle, {
      id: 'ex-in',
      type: 'expense',
      amountMinorUnits: 10000,
      date: range.start,
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'ex-out',
      type: 'expense',
      amountMinorUnits: 20000,
      date: addDays(range.start, -1),
      categoryId: 'cat-food',
    });

    await upsertBudget(db, { monthKey, categoryId: 'cat-food', budgetedMinorUnits: 50000 });

    const data = await getBudgetsData(db, monthKey);

    expect(data.range).toEqual(range);
    expect(data.rows[0].spentMinorUnits).toBe(10000);
  });

  it('splits budgeted categories from the "no budget set" section', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-transport', name: 'Transport' });

    const monthKey = periodMonthKey(todayIso(), 1);
    const range = requireRange(monthRange(monthKey, 1));

    insertTransaction(handle, { id: 'ex-food', type: 'expense', amountMinorUnits: 60000, date: range.start, categoryId: 'cat-food' });
    insertTransaction(handle, { id: 'ex-transport', type: 'expense', amountMinorUnits: 40000, date: range.start, categoryId: 'cat-transport' });

    await upsertBudget(db, { monthKey, categoryId: 'cat-food', budgetedMinorUnits: 100000 });

    const data = await getBudgetsData(db, monthKey);

    expect(data.rows.map((row) => row.categoryId)).toEqual(['cat-food']);
    expect(data.unbudgeted).toEqual([
      {
        categoryId: 'cat-transport',
        categoryName: 'Transport',
        categoryIcon: null,
        spentMinorUnits: 40000,
      },
    ]);
  });

  it('falls back to the current month when the month key is not usable', async () => {
    const { db } = createHarness();

    const data = await getBudgetsData(db, 'not-a-month');

    expect(data.monthKey).toBe(periodMonthKey(todayIso(), 1));
    expect(data.rows).toEqual([]);
    expect(data.unbudgeted).toEqual([]);
  });
});
