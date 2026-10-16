/**
 * Core domain types for PesaTrack.
 *
 * These describe what the app stores. They are deliberately separate from the
 * database code so that the rest of the app (screens, services, tests) can use
 * them without knowing anything about SQLite.
 */

/** The three kinds of money movement PesaTrack records. */
export type TransactionType = 'income' | 'expense' | 'saving';

/**
 * Need / Want / Unexpected classification.
 * Applies to expenses only — income and savings leave it `null`.
 */
export type NeedWant = 'need' | 'want' | 'unexpected';

/**
 * Direction of a saving transaction.
 * - `in`  : money moved from your available balance into savings
 * - `out` : money moved back out of savings into your available balance
 */
export type SavingDirection = 'in' | 'out';

/** Which transaction types a category may be used with. Must match `TransactionType`. */
export type CategoryType = TransactionType;

/**
 * A category groups transactions for reporting (food, transport, …).
 *
 * Categories are never deleted once used: they are marked `isActive: false`
 * instead, so historical transactions keep a valid category.
 */
export type Category = {
  id: string;
  name: string;
  type: CategoryType;
  /** Ionicon name, used for visual identification. */
  icon: string | null;
  /** Suggested Need/Want for expenses; the user can always override it. */
  defaultNeedWant: NeedWant | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

/**
 * A single recorded money movement.
 *
 * Important rules encoded here:
 * - `amountMinorUnits` is always a POSITIVE integer in minor units (cents).
 *   Direction is expressed by `type` and, for savings, `savingDirection`.
 * - `type = 'saving'` is NOT a consumption expense. It moves money out of the
 *   available balance without counting as spending.
 * - `needWant` is only ever set for expenses.
 * - `refundOfTransactionId` links a refund to the expense it reverses, so the
 *   refund reduces expenses instead of inflating income.
 */
export type Transaction = {
  id: string;
  type: TransactionType;
  /** Positive integer. KSh 1,250.50 is stored as 125050. */
  amountMinorUnits: number;
  /** Local calendar date as `YYYY-MM-DD` (never a UTC timestamp). */
  date: string;
  /** Short, required explanation: "Lunch", "Matatu to college". */
  description: string;
  /** Optional extra context. */
  notes: string | null;
  categoryId: string;
  needWant: NeedWant | null;
  paymentMethodId: string | null;
  /** Savings only: contribution (`in`) or withdrawal (`out`). */
  savingDirection: SavingDirection | null;
  /** Optional savings goal this contribution belongs to. */
  savingsGoalId: string | null;
  /** Set when this transaction is a refund of an earlier expense. */
  refundOfTransactionId: string | null;
  /** ISO timestamp of when the record was created. */
  createdAt: string;
  /** ISO timestamp of the last edit. */
  updatedAt: string;
};

/** A label describing how money moved (M-Pesa, Cash, Bank, …). Purely descriptive. */
export type PaymentMethod = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

/**
 * A budget for one expense category in one financial month.
 * `monthKey` is `YYYY-MM` and refers to the month in which the period starts.
 */
export type MonthlyBudget = {
  id: string;
  monthKey: string;
  categoryId: string;
  budgetedMinorUnits: number;
  createdAt: string;
  updatedAt: string;
};

/** Optional overall spending limit for a month (across all categories). */
export type MonthlyBudgetTotal = {
  id: string;
  monthKey: string;
  budgetedMinorUnits: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A savings goal, for example "Emergency Fund".
 *
 * There is deliberately no "contributions" table: contributions are ordinary
 * `saving` transactions linked with `savingsGoalId`. Because there is only one
 * place where a contribution is recorded, it cannot be counted twice.
 */
export type SavingsGoal = {
  id: string;
  name: string;
  targetMinorUnits: number;
  /** Money already in savings before using PesaTrack. Not income. */
  openingBalanceMinorUnits: number;
  /** Optional target date, `YYYY-MM-DD`. */
  targetDate: string | null;
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** A bill or commitment you expect to pay, used by the Safe-to-Spend estimate. */
export type Obligation = {
  id: string;
  name: string;
  amountMinorUnits: number;
  /** `YYYY-MM-DD` */
  dueDate: string;
  isPaid: boolean;
  /** Transaction that settled this obligation, if any. */
  paidTransactionId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThemePreference = 'system' | 'light' | 'dark';

/** Sort order options offered in the transaction list. */
export type TransactionSort = 'newest' | 'oldest' | 'highest' | 'lowest';

/**
 * Application settings. Stored as a single row so that reading them is one
 * query. Currency is stored as code + symbol so that adding other currencies
 * later does not require a schema change.
 */
export type AppSettings = {
  displayName: string | null;
  currencyCode: string;
  currencySymbol: string;
  /** Day of the month a financial month starts, 1–28. */
  financialMonthStartDay: number;
  themePreference: 'system' | 'light' | 'dark';
  /** Warn when spending reaches this percentage of a category budget. */
  budgetWarningThresholdPercent: number;
  defaultTransactionSort: 'newest' | 'oldest';
  /** Money held outside savings before the first recorded transaction. Not income. */
  startingBalanceMinorUnits: number;
  /** Savings already held before using PesaTrack. Not income. */
  savingsOpeningBalanceMinorUnits: number;
  onboardingCompleted: boolean;
};
