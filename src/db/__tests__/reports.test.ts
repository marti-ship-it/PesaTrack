/**
 * Verifies the Reports repository and the Reports screen's data against a real
 * SQLite engine — the same SQL the phone runs.
 *
 * These tests pin the *data* the report arithmetic is built from: that totals
 * are net of refunds, that savings transfers never leak into income or
 * expenses, that retired categories keep their real names, and that the
 * month-over-month comparison sees the previous financial month. They use
 * `node:sqlite` like `budgets.test.ts` and `schema.test.ts`, so no emulator or
 * native module is needed — the only bridge is a thin adapter exposing the
 * async methods the repositories call.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from '@jest/globals';

import {
  countTransactionsInRange,
  getCategoryBreakdownWithNames,
  getTotalsForPeriod,
  monthToPeriod,
} from '../repositories/reports';
import { summarizeTransactions } from '../repositories/transactions';
import { getReportsData, hasAnyTransactions } from '@/services/reports';
import { monthRange, type MonthRange } from '@/utils/dates';

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
  } as unknown as SQLiteDatabase;

  return { handle, db };
}

function insertCategory(
  handle: DatabaseSync,
  options: { id: string; name: string; type?: string; isActive?: boolean }
): void {
  handle
    .prepare(
      `INSERT INTO categories (
         id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at
       ) VALUES (?, ?, ?, NULL, NULL, 0, ?, 0, ?);`
    )
    .run(
      options.id,
      options.name,
      options.type ?? 'expense',
      options.isActive === false ? 0 : 1,
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

function insertBudget(
  handle: DatabaseSync,
  monthKey: string,
  categoryId: string,
  amountMinorUnits: number
): void {
  handle
    .prepare(
      `INSERT INTO monthly_budgets (
         id, month_key, category_id, budgeted_minor_units, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?);`
    )
    .run(`budget-${monthKey}-${categoryId}`, monthKey, categoryId, amountMinorUnits, TIMESTAMP, TIMESTAMP);
}

function requireRange(range: MonthRange | null): MonthRange {
  if (!range) {
    throw new Error('Expected a month range.');
  }
  return range;
}

describe('reports repository', () => {
  it('returns zeros for an empty period', async () => {
    const { db } = createHarness();
    const period = monthToPeriod('2026-10');

    const totals = await getTotalsForPeriod(db, period);

    expect(totals).toEqual({
      incomeMinorUnits: 0,
      expensesNetMinorUnits: 0,
      savingsInMinorUnits: 0,
      savingsOutMinorUnits: 0,
    });
  });

  it('summarises income and expenses net of refunds', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-salary', name: 'Salary', type: 'income' });
    insertTransaction(handle, {
      id: 'txn-1',
      type: 'expense',
      amountMinorUnits: 1000,
      date: '2026-10-05',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'txn-2',
      type: 'expense',
      amountMinorUnits: 400,
      date: '2026-10-06',
      categoryId: 'cat-food',
      refundOf: 'txn-1',
    });
    insertTransaction(handle, {
      id: 'txn-3',
      type: 'income',
      amountMinorUnits: 5000,
      date: '2026-10-10',
      categoryId: 'cat-salary',
    });

    const totals = await getTotalsForPeriod(db, monthToPeriod('2026-10'));

    // 1000 spent - 400 refunded = 600 net; the refund is not income.
    expect(totals.expensesNetMinorUnits).toBe(600);
    expect(totals.incomeMinorUnits).toBe(5000);
  });

  it('keeps savings transfers out of income and expenses', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-pot', name: 'Emergency fund', type: 'saving' });
    insertTransaction(handle, {
      id: 'txn-in',
      type: 'saving',
      amountMinorUnits: 2000,
      date: '2026-10-05',
      categoryId: 'cat-pot',
      savingDirection: 'out',
    });
    insertTransaction(handle, {
      id: 'txn-out',
      type: 'saving',
      amountMinorUnits: 500,
      date: '2026-10-06',
      categoryId: 'cat-pot',
      savingDirection: 'in',
    });

    const totals = await getTotalsForPeriod(db, monthToPeriod('2026-10'));

    expect(totals.incomeMinorUnits).toBe(0);
    expect(totals.expensesNetMinorUnits).toBe(0);
    expect(totals.savingsInMinorUnits).toBe(500);
    expect(totals.savingsOutMinorUnits).toBe(2000);
  });

  it('includes retired categories that still have transactions', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-old', name: 'Old category', isActive: false });
    insertTransaction(handle, {
      id: 'txn-1',
      type: 'expense',
      amountMinorUnits: 500,
      date: '2026-10-05',
      categoryId: 'cat-old',
    });

    const breakdown = await getCategoryBreakdownWithNames(db, monthToPeriod('2026-10'));

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].name).toBe('Old category');
    expect(breakdown[0].netMinorUnits).toBe(500);
  });

  it('counts transactions inside a range only', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertTransaction(handle, {
      id: 'txn-oct',
      type: 'expense',
      amountMinorUnits: 1000,
      date: '2026-10-05',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'txn-sep',
      type: 'expense',
      amountMinorUnits: 700,
      date: '2026-09-20',
      categoryId: 'cat-food',
    });

    const count = await countTransactionsInRange(db, monthToPeriod('2026-10'));

    expect(count).toBe(1);
  });
});

describe('getReportsData', () => {
  it('reports zero totals and no transactions on a fresh database', async () => {
    const { db } = createHarness();

    const data = await getReportsData(db, '2026-10');

    expect(data.monthKey).toBe('2026-10');
    expect(data.totals.incomeMinorUnits).toBe(0);
    expect(data.totals.expensesNetMinorUnits).toBe(0);
    expect(data.totalTransactionCount).toBe(0);
    expect(hasAnyTransactions(data.totalTransactionCount)).toBe(false);
    expect(data.breakdown).toEqual([]);
    expect(data.budgetRows).toEqual([]);
  });

  it('summarises a month, compares it with the previous month, and lists shares', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-transport', name: 'Transport' });
    insertCategory(handle, { id: 'cat-salary', name: 'Salary', type: 'income' });

    // Previous month: 3000 income, 1000 expense.
    insertTransaction(handle, {
      id: 'sep-income',
      type: 'income',
      amountMinorUnits: 3000,
      date: '2026-09-10',
      categoryId: 'cat-salary',
    });
    insertTransaction(handle, {
      id: 'sep-expense',
      type: 'expense',
      amountMinorUnits: 1000,
      date: '2026-09-12',
      categoryId: 'cat-food',
    });

    // Current month: 5000 income, 600 net expense (1000 - 400 refund).
    insertTransaction(handle, {
      id: 'oct-income',
      type: 'income',
      amountMinorUnits: 5000,
      date: '2026-10-10',
      categoryId: 'cat-salary',
    });
    insertTransaction(handle, {
      id: 'oct-expense',
      type: 'expense',
      amountMinorUnits: 1000,
      date: '2026-10-12',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'oct-refund',
      type: 'expense',
      amountMinorUnits: 400,
      date: '2026-10-13',
      categoryId: 'cat-food',
      refundOf: 'oct-expense',
    });
    insertTransaction(handle, {
      id: 'oct-transport',
      type: 'expense',
      amountMinorUnits: 400,
      date: '2026-10-14',
      categoryId: 'cat-transport',
    });

    const data = await getReportsData(db, '2026-10');

    expect(data.totalTransactionCount).toBe(6);
    expect(hasAnyTransactions(data.totalTransactionCount)).toBe(true);

    expect(data.totals.incomeMinorUnits).toBe(5000);
    expect(data.totals.expensesNetMinorUnits).toBe(1000); // 600 + 400

    // Previous financial month, same rules.
    expect(data.comparison.previous.incomeMinorUnits).toBe(3000);
    expect(data.comparison.previous.expensesNetMinorUnits).toBe(1000);
    expect(data.comparison.incomeDeltaMinorUnits).toBe(2000);
    expect(data.comparison.expensesDeltaMinorUnits).toBe(0);
    expect(data.comparison.hasPreviousData).toBe(true);

    // Biggest net spender first; shares are of positive net spend.
    expect(data.breakdown.map((row) => row.categoryId)).toEqual([
      'cat-food',
      'cat-transport',
    ]);
    expect(data.breakdown[0].netMinorUnits).toBe(600);
    expect(data.breakdown[1].netMinorUnits).toBe(400);
    expect(data.breakdown[0].sharePercent).toBeCloseTo(60);
    expect(data.breakdown[1].sharePercent).toBeCloseTo(40);

    // Six months of trend ending at the selected month.
    expect(data.series).toHaveLength(6);
    expect(data.series[5].monthKey).toBe('2026-10');
    expect(data.series[5].totals.expensesNetMinorUnits).toBe(1000);
    expect(data.series[4].monthKey).toBe('2026-09');
    expect(data.series[4].totals.incomeMinorUnits).toBe(3000);
  });

  it('marks the comparison as having no previous data when the previous month is empty', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertTransaction(handle, {
      id: 'oct-expense',
      type: 'expense',
      amountMinorUnits: 500,
      date: '2026-10-12',
      categoryId: 'cat-food',
    });

    const data = await getReportsData(db, '2026-10');

    expect(data.comparison.hasPreviousData).toBe(false);
    expect(data.comparison.previous.expensesNetMinorUnits).toBe(0);
    expect(data.comparison.expensesDeltaMinorUnits).toBe(500);
  });

  it('joins budgets with actual net spending for budget performance', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-food', name: 'Food' });
    insertCategory(handle, { id: 'cat-transport', name: 'Transport' });
    insertBudget(handle, '2026-10', 'cat-food', 1000);
    insertBudget(handle, '2026-10', 'cat-transport', 5000);

    // Food: 1500 spent minus a 200 refund = 1300 against a 1000 budget.
    insertTransaction(handle, {
      id: 'txn-1',
      type: 'expense',
      amountMinorUnits: 1500,
      date: '2026-10-05',
      categoryId: 'cat-food',
    });
    insertTransaction(handle, {
      id: 'txn-2',
      type: 'expense',
      amountMinorUnits: 200,
      date: '2026-10-06',
      categoryId: 'cat-food',
      refundOf: 'txn-1',
    });

    const data = await getReportsData(db, '2026-10');

    expect(data.budgetRows).toHaveLength(2);
    // Most at-risk first: Food (1300 vs 1000 budget = exceeded) leads.
    expect(data.budgetRows[0].categoryId).toBe('cat-food');
    expect(data.budgetRows[0].budgetedMinorUnits).toBe(1000);
    expect(data.budgetRows[0].spentMinorUnits).toBe(1300);
    expect(data.budgetRows[0].status).toBe('exceeded');
    expect(data.budgetRows[1].categoryId).toBe('cat-transport');
    expect(data.budgetRows[1].spentMinorUnits).toBe(0);
    expect(data.budgetRows[1].status).toBe('under');
  });

  it('never counts savings transfers as spending against a budget', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, { id: 'cat-pot', name: 'Emergency fund', type: 'saving' });
    insertTransaction(handle, {
      id: 'txn-in',
      type: 'saving',
      amountMinorUnits: 9000,
      date: '2026-10-05',
      categoryId: 'cat-pot',
      savingDirection: 'out',
    });

    const totals = await summarizeTransactions(db, {
      from: requireRange(monthRange('2026-10')).start,
      to: requireRange(monthRange('2026-10')).end,
    });

    expect(totals.expensesNetMinorUnits).toBe(0);
    expect(totals.incomeMinorUnits).toBe(0);
    expect(totals.savingsOutMinorUnits).toBe(9000);
  });
});
