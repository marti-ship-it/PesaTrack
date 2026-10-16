import type { SQLiteDatabase } from 'expo-sqlite';

import type { Category } from '@/types/models';
import type { IsoDate, MonthKey } from '@/utils/dates';
import { monthKeyOf } from '@/utils/dates';

import { listCategories } from './categories';
import {
  type CategoryExpenseTotal,
  summarizeExpensesByCategory,
  summarizeTransactions,
  type TransactionFilter,
  type TransactionTotals,
} from './transactions';

export type Period = {
  /** Inclusive `YYYY-MM-DD`. */
  from: IsoDate;
  /** Inclusive `YYYY-MM-DD`. */
  to: IsoDate;
};

export type MonthlyTotal = {
  month: MonthKey;
  incomeMinorUnits: number;
  expensesNetMinorUnits: number;
};

export type CategoryBreakdownItem = {
  categoryId: string;
  name: string;
  type: 'income' | 'expense' | 'saving';
  netMinorUnits: number;
};

export type CategoryBreakdownWithNames = CategoryBreakdownItem[];

export type BudgetPerformanceItem = {
  categoryId: string;
  name: string;
  budgetMinorUnits: number;
  actualNetMinorUnits: number;
};

export type BudgetPerformance = BudgetPerformanceItem[];

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function normalizeMonthKey(month: string): MonthKey {
  const trimmed = month.trim();
  if (!MONTH_KEY_RE.test(trimmed)) {
    return monthKeyOf(trimmed) || trimmed;
  }
  return trimmed;
}

export function monthToPeriod(month: MonthKey): Period {
  const m = normalizeMonthKey(month);
  const [yearStr, monthStr] = m.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const first = `${yearStr}-${monthStr.padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate();
  const last = `${yearStr}-${monthStr.padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from: first, to: last };
}

export async function countTransactionsInRange(
  db: SQLiteDatabase,
  filter: Pick<TransactionFilter, 'from' | 'to'> = {}
): Promise<number> {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (filter.from) {
    conditions.push('date >= ?');
    parameters.push(filter.from);
  }
  if (filter.to) {
    conditions.push('date <= ?');
    parameters.push(filter.to);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM transactions ${whereClause};`,
    parameters
  );
  return row?.count ?? 0;
}

export async function getTotalsForPeriod(
  db: SQLiteDatabase,
  period: Period
): Promise<TransactionTotals> {
  return summarizeTransactions(db, { from: period.from, to: period.to });
}

export async function getCategoryBreakdownWithNames(
  db: SQLiteDatabase,
  period: Period
): Promise<CategoryBreakdownWithNames> {
  const [expenseTotals, categories] = await Promise.all([
    summarizeExpensesByCategory(db, { from: period.from, to: period.to }),
    listCategories(db, { includeInactive: true }),
  ]);
  const categoryMap = new Map<string, Category>();
  for (const c of categories) {
    categoryMap.set(c.id, c);
  }
  return expenseTotals.map((t: CategoryExpenseTotal) => {
    const cat = categoryMap.get(t.categoryId);
    return {
      categoryId: t.categoryId,
      name: cat?.name ?? 'Uncategorized',
      type: cat?.type ?? 'expense',
      netMinorUnits: t.netMinorUnits,
    };
  });
}

export async function getMonthlyTotalsSeries(
  db: SQLiteDatabase,
  months: MonthKey[]
): Promise<MonthlyTotal[]> {
  const results: MonthlyTotal[] = [];
  for (const m of months) {
    const p = monthToPeriod(m);
    const totals = await summarizeTransactions(db, { from: p.from, to: p.to });
    results.push({
      month: normalizeMonthKey(m),
      incomeMinorUnits: totals.incomeMinorUnits,
      expensesNetMinorUnits: totals.expensesNetMinorUnits,
    });
  }
  return results;
}