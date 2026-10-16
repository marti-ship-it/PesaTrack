import { describe, expect, it } from '@jest/globals';

import {
  buildCategoryShares,
  buildMonthlyComparison,
  hasAnyTransactions,
} from '@/services/reports';
import type { CategoryBreakdownWithNames } from '@/db/repositories/reports';
import type { TransactionTotals } from '@/db/repositories/transactions';
import type { Category } from '@/types/models';

function totals(income: number, expenses: number): TransactionTotals {
  return {
    incomeMinorUnits: income,
    expensesNetMinorUnits: expenses,
    savingsInMinorUnits: 0,
    savingsOutMinorUnits: 0,
  };
}

describe('buildMonthlyComparison', () => {
  it('computes signed deltas between the two months', () => {
    const comparison = buildMonthlyComparison({
      currentMonthKey: '2026-10',
      previousMonthKey: '2026-09',
      current: totals(5000, 1000),
      previous: totals(4000, 1200),
      previousTransactionCount: 3,
    });

    expect(comparison.incomeDeltaMinorUnits).toBe(1000);
    expect(comparison.expensesDeltaMinorUnits).toBe(-200);
    expect(comparison.hasPreviousData).toBe(true);
  });

  it('flags an empty previous period instead of pretending the delta is progress', () => {
    const comparison = buildMonthlyComparison({
      currentMonthKey: '2026-10',
      previousMonthKey: '2026-09',
      current: totals(5000, 1000),
      previous: totals(0, 0),
      previousTransactionCount: 0,
    });

    expect(comparison.hasPreviousData).toBe(false);
    expect(comparison.incomeDeltaMinorUnits).toBe(5000);
    expect(comparison.expensesDeltaMinorUnits).toBe(1000);
  });
});

describe('buildCategoryShares', () => {
  const categories: Category[] = [
    {
      id: 'cat-food',
      name: 'Food',
      type: 'expense',
      icon: null,
      defaultNeedWant: null,
      isDefault: false,
      isActive: true,
      sortOrder: 0,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'cat-transport',
      name: 'Transport',
      type: 'expense',
      icon: null,
      defaultNeedWant: null,
      isDefault: false,
      isActive: true,
      sortOrder: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'cat-returns',
      name: 'Returns',
      type: 'expense',
      icon: null,
      defaultNeedWant: null,
      isDefault: false,
      isActive: false,
      sortOrder: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];

  it('sorts biggest net spender first and computes shares of positive spend', () => {
    const breakdown: CategoryBreakdownWithNames = [
      { categoryId: 'cat-transport', name: 'Transport', type: 'expense', netMinorUnits: 400 },
      { categoryId: 'cat-food', name: 'Food', type: 'expense', netMinorUnits: 600 },
    ];

    const rows = buildCategoryShares(breakdown, categories);

    expect(rows.map((row) => row.categoryId)).toEqual(['cat-food', 'cat-transport']);
    expect(rows[0].sharePercent).toBeCloseTo(60);
    expect(rows[1].sharePercent).toBeCloseTo(40);
  });

  it('keeps a retired category name from the database, not the query', () => {
    const breakdown: CategoryBreakdownWithNames = [
      { categoryId: 'cat-returns', name: 'Wrong', type: 'expense', netMinorUnits: 100 },
    ];

    const rows = buildCategoryShares(breakdown, categories);

    expect(rows[0].name).toBe('Returns');
  });

  it('gives negative net spending no share instead of an invented percentage', () => {
    const breakdown: CategoryBreakdownWithNames = [
      { categoryId: 'cat-returns', name: 'Returns', type: 'expense', netMinorUnits: -200 },
      { categoryId: 'cat-food', name: 'Food', type: 'expense', netMinorUnits: 100 },
    ];

    const rows = buildCategoryShares(breakdown, categories);

    // Negative nets sort last and carry no share of positive spending.
    expect(rows[0].categoryId).toBe('cat-food');
    expect(rows[1].netMinorUnits).toBe(-200);
    expect(rows[1].sharePercent).toBeNull();
    expect(rows[0].sharePercent).toBe(100);
  });

  it('falls back to the queried name for a category the lookup missed', () => {
    const breakdown: CategoryBreakdownWithNames = [
      { categoryId: 'cat-unknown', name: 'Unknown', type: 'expense', netMinorUnits: 100 },
    ];

    const rows = buildCategoryShares(breakdown, categories);

    expect(rows[0].name).toBe('Unknown');
  });
});

describe('hasAnyTransactions', () => {
  it('is false only when the database has no transactions at all', () => {
    expect(hasAnyTransactions(0)).toBe(false);
    expect(hasAnyTransactions(1)).toBe(true);
  });
});
