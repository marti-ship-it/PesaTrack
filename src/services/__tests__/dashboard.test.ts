/**
 * Tests the dashboard's calculation rules.
 *
 * `buildDashboardTotals` derives the four numbers Home shows from sums the
 * database produced, and `resolveDashboardRange` decides which dates a period
 * covers. Both are pure, so month boundaries — which only exist on particular
 * calendar days — can be pinned down with fixed inputs instead of waiting for
 * the real date to change.
 */
import type { TransactionTotals } from '@/db/repositories/transactions';

import { buildDashboardTotals, resolveDashboardRange } from '../dashboard';

const ZERO: TransactionTotals = {
  incomeMinorUnits: 0,
  expensesNetMinorUnits: 0,
  savingsInMinorUnits: 0,
  savingsOutMinorUnits: 0,
};

function totals(overrides: Partial<TransactionTotals>): TransactionTotals {
  return { ...ZERO, ...overrides };
}

describe('buildDashboardTotals', () => {
  it('shows all zeros when there are no transactions', () => {
    expect(buildDashboardTotals(ZERO, ZERO, 0)).toEqual({
      currentBalanceMinorUnits: 0,
      totalIncomeMinorUnits: 0,
      totalExpensesMinorUnits: 0,
      savedThisPeriodMinorUnits: 0,
    });
  });

  it('adds the starting balance to the balance but never counts it as income', () => {
    const summary = buildDashboardTotals(ZERO, ZERO, 500000);

    expect(summary.currentBalanceMinorUnits).toBe(500000);
    expect(summary.totalIncomeMinorUnits).toBe(0);
    expect(summary.totalExpensesMinorUnits).toBe(0);
    expect(summary.savedThisPeriodMinorUnits).toBe(0);
  });

  it('totals income only', () => {
    const incomeOnly = totals({ incomeMinorUnits: 500000 });
    const summary = buildDashboardTotals(incomeOnly, incomeOnly, 100000);

    expect(summary.currentBalanceMinorUnits).toBe(600000);
    expect(summary.totalIncomeMinorUnits).toBe(500000);
    expect(summary.totalExpensesMinorUnits).toBe(0);
    expect(summary.savedThisPeriodMinorUnits).toBe(0);
  });

  it('totals expenses only, letting the balance go negative', () => {
    const expensesOnly = totals({ expensesNetMinorUnits: 123000 });
    const summary = buildDashboardTotals(expensesOnly, expensesOnly, 0);

    expect(summary.currentBalanceMinorUnits).toBe(-123000);
    expect(summary.totalExpensesMinorUnits).toBe(123000);
    expect(summary.totalIncomeMinorUnits).toBe(0);
  });

  it('totals mixed income and expenses', () => {
    const mixed = totals({ incomeMinorUnits: 500000, expensesNetMinorUnits: 123000 });
    const summary = buildDashboardTotals(mixed, mixed, 200000);

    // 200000 opening balance + 500000 income − 123000 spent.
    expect(summary.currentBalanceMinorUnits).toBe(577000);
    expect(summary.totalIncomeMinorUnits).toBe(500000);
    expect(summary.totalExpensesMinorUnits).toBe(123000);
    expect(summary.savedThisPeriodMinorUnits).toBe(0);
  });

  it('never double-counts savings', () => {
    const withSavings = totals({
      incomeMinorUnits: 500000,
      expensesNetMinorUnits: 100000,
      savingsInMinorUnits: 50000,
      savingsOutMinorUnits: 10000,
    });
    const summary = buildDashboardTotals(withSavings, withSavings, 0);

    // Savings leave the balance (and part returns), but they are neither
    // income nor expenses, so those two tiles must show exactly their inputs.
    expect(summary.currentBalanceMinorUnits).toBe(360000); // 500000 − 100000 − 50000 + 10000
    expect(summary.totalIncomeMinorUnits).toBe(500000);
    expect(summary.totalExpensesMinorUnits).toBe(100000);
    expect(summary.savedThisPeriodMinorUnits).toBe(40000); // 50000 in − 10000 out
  });

  it('scopes the tiles to the period while the balance stays all-time', () => {
    // Nothing happened this period, but the history still exists.
    const allTime = totals({
      incomeMinorUnits: 500000,
      expensesNetMinorUnits: 200000,
      savingsInMinorUnits: 50000,
    });
    const summary = buildDashboardTotals(ZERO, allTime, 0);

    expect(summary.totalIncomeMinorUnits).toBe(0);
    expect(summary.totalExpensesMinorUnits).toBe(0);
    expect(summary.savedThisPeriodMinorUnits).toBe(0);
    expect(summary.currentBalanceMinorUnits).toBe(250000);
  });

  it('passes a refund-heavy period through as negative expenses and money returned', () => {
    // A period with more refunds than spending is real: the net figure is
    // negative, and that money went back into the balance.
    const refundHeavy = totals({ expensesNetMinorUnits: -5000 });
    const summary = buildDashboardTotals(refundHeavy, refundHeavy, 0);

    expect(summary.totalExpensesMinorUnits).toBe(-5000);
    expect(summary.currentBalanceMinorUnits).toBe(5000);
    expect(summary.totalIncomeMinorUnits).toBe(0);
  });
});

describe('resolveDashboardRange', () => {
  it('applies no date filter for all time', () => {
    expect(resolveDashboardRange('all-time', 1, '2026-10-16')).toBeNull();
    expect(resolveDashboardRange('all-time', 25, '2026-10-16')).toBeNull();
  });

  it('covers the whole calendar month when the start day is 1', () => {
    expect(resolveDashboardRange('financial-month', 1, '2026-10-16')).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });

  it('puts days before the start day in the previous financial month', () => {
    // Start day 25: mid-October still belongs to the period that began 25 Sep.
    expect(resolveDashboardRange('financial-month', 25, '2026-10-16')).toEqual({
      start: '2026-09-25',
      end: '2026-10-24',
    });
  });

  it('opens the next period exactly on the start day, across a year boundary', () => {
    expect(resolveDashboardRange('financial-month', 25, '2026-10-25')).toEqual({
      start: '2026-10-25',
      end: '2026-11-24',
    });
    expect(resolveDashboardRange('financial-month', 28, '2026-12-31')).toEqual({
      start: '2026-12-28',
      end: '2027-01-27',
    });
  });

  it('throws rather than silently treating an unresolvable date as all time', () => {
    expect(() => resolveDashboardRange('financial-month', 1, 'not-a-date')).toThrow();
  });
});
