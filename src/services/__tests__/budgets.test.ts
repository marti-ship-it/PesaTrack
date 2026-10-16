/**
 * Tests the budget calculation rules.
 *
 * `resolveBudgetStatus`, `buildBudgetRows` and `budgetAmountError` decide
 * everything the Budgets screen shows: which status a category has, how the
 * progress is clamped, which categories are "no budget set", and how the two
 * lists are ordered. They are pure, so the awkward cases -?" a category whose
 * refunds exceed its spending, a category with a budget but no spend -?" can be
 * pinned down with fixed inputs instead of a database.
 */
import type { Category, MonthlyBudget } from '@/types/models';

import {
  budgetAmountError,
  buildBudgetRows,
  buildBudgetsTotals,
  buildCategoryBudgetRow,
  resolveBudgetStatus,
} from '../budgets';

const THRESHOLD = 80;
const TIMESTAMP = '2026-10-01T00:00:00.000Z';

function expense(id: string, name: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    name,
    type: 'expense',
    icon: null,
    defaultNeedWant: 'need',
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

function budget(categoryId: string, budgetedMinorUnits: number): MonthlyBudget {
  return {
    id: `budget-${categoryId}`,
    monthKey: '2026-10',
    categoryId,
    budgetedMinorUnits,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

/** Builds the spend map from pairs, mirroring the SQL layer's shape. */
function spending(entries: readonly (readonly [string, number])[]): Map<string, number> {
  return new Map(entries);
}

describe('resolveBudgetStatus', () => {
  it('is under the limit below the warning threshold', () => {
    expect(resolveBudgetStatus(0, 5000, THRESHOLD)).toBe('under');
    expect(resolveBudgetStatus(3999, 5000, THRESHOLD)).toBe('under');
  });

  it('turns "near" exactly at the threshold and stays there until the limit', () => {
    // 80% of 5000 is 4000.
    expect(resolveBudgetStatus(4000, 5000, THRESHOLD)).toBe('near');
    expect(resolveBudgetStatus(4999, 5000, THRESHOLD)).toBe('near');
  });

  it('is "reached" only when spending exactly matches the budget', () => {
    expect(resolveBudgetStatus(5000, 5000, THRESHOLD)).toBe('reached');
  });

  it('is "exceeded" once spending goes over the budget', () => {
    expect(resolveBudgetStatus(5001, 5000, THRESHOLD)).toBe('exceeded');
  });

  it('honours a different warning threshold', () => {
    expect(resolveBudgetStatus(3000, 5000, 50)).toBe('near'); // 60% >= 50%
    expect(resolveBudgetStatus(2400, 5000, 50)).toBe('under'); // 48% < 50%
  });

  it('keeps refund-only (negative) spending under budget and never clamps it', () => {
    // A period with more refunds than spending gives the user money back, so
    // there is plenty of budget left. Clamping this to 0 would hide that.
    expect(resolveBudgetStatus(-1000, 5000, THRESHOLD)).toBe('under');
    expect(resolveBudgetStatus(-1, 5000, THRESHOLD)).toBe('under');
  });
});

describe('buildCategoryBudgetRow', () => {
  it('computes remaining, percent and progress', () => {
    const row = buildCategoryBudgetRow(expense('cat-food', 'Food'), 10000, 6000, THRESHOLD);

    expect(row.remainingMinorUnits).toBe(4000);
    expect(row.percentUsed).toBeCloseTo(60);
    expect(row.progress).toBeCloseTo(0.6);
    expect(row.status).toBe('under');
  });

  it('clamps progress at 1 when the category is overspent', () => {
    const row = buildCategoryBudgetRow(expense('cat-food', 'Food'), 10000, 15000, THRESHOLD);

    expect(row.percentUsed).toBeCloseTo(150);
    expect(row.progress).toBe(1);
    expect(row.remainingMinorUnits).toBe(-5000);
    expect(row.status).toBe('exceeded');
  });

  it('clamps progress at 0 for refund-only spending while keeping remaining honest', () => {
    const row = buildCategoryBudgetRow(expense('cat-food', 'Food'), 10000, -3000, THRESHOLD);

    expect(row.progress).toBe(0);
    expect(row.percentUsed).toBeLessThan(0);
    // The user has their whole budget plus the money that came back.
    expect(row.remainingMinorUnits).toBe(13000);
  });

  it('carries the category name and icon through for display', () => {
    const row = buildCategoryBudgetRow(expense('cat-food', 'Food', { icon: 'cart-outline' }), 10000, 0, THRESHOLD);

    expect(row.categoryId).toBe('cat-food');
    expect(row.categoryName).toBe('Food');
    expect(row.categoryIcon).toBe('cart-outline');
  });
});

describe('buildBudgetRows', () => {
  const FOOD = expense('cat-food', 'Food');
  const TRANSPORT = expense('cat-transport', 'Transport');
  const EATING_OUT = expense('cat-eating', 'Eating Out');
  const SALARY = expense('cat-salary', 'Salary', { type: 'income', defaultNeedWant: null });
  const SAVINGS = expense('cat-savings', 'Savings', { type: 'saving', defaultNeedWant: null });

  it('only considers expense categories', () => {
    const { rows, unbudgeted } = buildBudgetRows({
      categories: [FOOD, SALARY, SAVINGS],
      budgets: [budget('cat-food', 10000)],
      spentByCategory: spending([
        ['cat-food', 6000],
        ['cat-salary', 999999],
        ['cat-savings', 999999],
      ]),
      thresholdPercent: THRESHOLD,
    });

    expect(rows.map((row) => row.categoryId)).toEqual(['cat-food']);
    expect(unbudgeted).toEqual([]);
  });

  it('routes a category with a budget into rows and one with spend but no budget into unbudgeted', () => {
    const { rows, unbudgeted } = buildBudgetRows({
      categories: [FOOD, EATING_OUT],
      budgets: [budget('cat-food', 10000)],
      spentByCategory: spending([
        ['cat-food', 6000],
        ['cat-eating', 2000],
      ]),
      thresholdPercent: THRESHOLD,
    });

    expect(rows.map((row) => row.categoryId)).toEqual(['cat-food']);
    expect(unbudgeted).toEqual([
      {
        categoryId: 'cat-eating',
        categoryName: 'Eating Out',
        categoryIcon: null,
        spentMinorUnits: 2000,
      },
    ]);
  });

  it('treats a budgeted category with no spending as under budget, not as "no budget"', () => {
    const { rows, unbudgeted } = buildBudgetRows({
      categories: [FOOD],
      budgets: [budget('cat-food', 10000)],
      spentByCategory: spending([]),
      thresholdPercent: THRESHOLD,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].spentMinorUnits).toBe(0);
    expect(rows[0].status).toBe('under');
    expect(unbudgeted).toEqual([]);
  });

  it('leaves categories with zero or refund-only spending out of "no budget set"', () => {
    const FOOD = expense('cat-food', 'Food');
    const FULLY_REFUNDED = expense('cat-refunded', 'Fully refunded');
    const REFUND_ONLY = expense('cat-refundonly', 'Refund only');

    const { unbudgeted } = buildBudgetRows({
      categories: [FOOD, FULLY_REFUNDED, REFUND_ONLY],
      budgets: [],
      spentByCategory: spending([
        ['cat-food', 0],
        ['cat-refunded', 0],
        ['cat-refundonly', -500],
      ]),
      thresholdPercent: THRESHOLD,
    });

    // None of these is unplanned *spending*, so none belongs in the section.
    expect(unbudgeted).toEqual([]);
  });

  it('only asks about spending in the month, not all-time spend', () => {
    // The spent map passed in is already scoped to the month's date range.
    const { unbudgeted } = buildBudgetRows({
      categories: [FOOD],
      budgets: [],
      spentByCategory: spending([]),
      thresholdPercent: THRESHOLD,
    });

    expect(unbudgeted).toEqual([]);
  });

  it('lists the most at-risk budget first, then the biggest spender', () => {
    const { rows } = buildBudgetRows({
      categories: [FOOD, TRANSPORT, EATING_OUT],
      budgets: [
        budget('cat-food', 10000),
        budget('cat-transport', 1000),
        budget('cat-eating', 10000),
      ],
      spentByCategory: spending([
        ['cat-food', 6000], // 60% under
        ['cat-transport', 1500], // exceeded
        ['cat-eating', 9000], // near
      ]),
      thresholdPercent: THRESHOLD,
    });

    expect(rows.map((row) => row.categoryId)).toEqual([
      'cat-transport', // exceeded
      'cat-eating', // near
      'cat-food', // under
    ]);
  });

  it('breaks ties by name so the order is stable', () => {
    const ALPHA = expense('cat-a', 'Alpha');
    const BETA = expense('cat-b', 'Beta');

    const { rows } = buildBudgetRows({
      categories: [BETA, ALPHA],
      budgets: [budget('cat-b', 10000), budget('cat-a', 10000)],
      spentByCategory: spending([
        ['cat-b', 5000],
        ['cat-a', 5000],
      ]),
      thresholdPercent: THRESHOLD,
    });

    expect(rows.map((row) => row.categoryId)).toEqual(['cat-a', 'cat-b']);
  });

  it('lists unbudgeted categories by spending, highest first', () => {
    const A = expense('cat-a', 'Alpha');
    const B = expense('cat-b', 'Beta');
    const C = expense('cat-c', 'Gamma');

    const { unbudgeted } = buildBudgetRows({
      categories: [A, B, C],
      budgets: [],
      spentByCategory: spending([
        ['cat-a', 100],
        ['cat-b', 300],
        ['cat-c', 200],
      ]),
      thresholdPercent: THRESHOLD,
    });

    expect(unbudgeted.map((row) => row.categoryId)).toEqual(['cat-b', 'cat-c', 'cat-a']);
  });
});

describe('buildBudgetsTotals', () => {
  it('is zero when nothing has a budget', () => {
    expect(buildBudgetsTotals([])).toEqual({
      budgetedMinorUnits: 0,
      spentMinorUnits: 0,
      remainingMinorUnits: 0,
    });
  });

  it('sums only the categories that have a budget', () => {
    const FOOD = expense('cat-food', 'Food');
    const TRANSPORT = expense('cat-transport', 'Transport');
    const EATING_OUT = expense('cat-eating', 'Eating Out');

    const { rows } = buildBudgetRows({
      categories: [FOOD, TRANSPORT, EATING_OUT],
      budgets: [budget('cat-food', 10000), budget('cat-transport', 5000)],
      spentByCategory: spending([
        ['cat-food', 6000],
        ['cat-transport', 6000],
        ['cat-eating', 2000], // has no budget, so it is excluded here
      ]),
      thresholdPercent: THRESHOLD,
    });

    // 15000 budgeted, 12000 spent, 3000 left.
    expect(buildBudgetsTotals(rows)).toEqual({
      budgetedMinorUnits: 15000,
      spentMinorUnits: 12000,
      remainingMinorUnits: 3000,
    });
  });

  it('keeps a negative remaining when a category overspends', () => {
    const FOOD = expense('cat-food', 'Food');

    const { rows } = buildBudgetRows({
      categories: [FOOD],
      budgets: [budget('cat-food', 1000)],
      spentByCategory: spending([['cat-food', 1500]]),
      thresholdPercent: THRESHOLD,
    });

    expect(buildBudgetsTotals(rows).remainingMinorUnits).toBe(-500);
  });
});

describe('budgetAmountError', () => {
  it('accepts a plain amount', () => {
    expect(budgetAmountError('5000')).toBeNull();
  });

  it('accepts an amount with decimals and thousands separators', () => {
    expect(budgetAmountError('1250.50')).toBeNull();
    expect(budgetAmountError('1,250')).toBeNull();
  });

  it('rejects an empty or non-numeric amount', () => {
    expect(budgetAmountError('')).toMatch(/valid amount/i);
    expect(budgetAmountError('abc')).toMatch(/valid amount/i);
    expect(budgetAmountError('12.345')).toMatch(/valid amount/i);
  });

  it('rejects zero and negative amounts', () => {
    expect(budgetAmountError('0')).toMatch(/more than zero/i);
    expect(budgetAmountError('-500')).toMatch(/valid amount/i);
  });
});
