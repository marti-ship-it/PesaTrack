/**
 * The PesaTrack database schema, version 1.
 *
 * Design rules this file follows:
 *
 * 1. **Money is an integer.** Every amount column stores minor units (cents),
 *    e.g. KSh 1,250.50 -> `125050`. No REAL columns anywhere, ever.
 *
 * 2. **The database refuses impossible data.** Rules that can be expressed in
 *    SQL are `CHECK` constraints, not just UI hints. For example an `income`
 *    row cannot carry a Need/Want label even if a buggy screen tries to save
 *    one. Form validation is for showing friendly messages; these constraints
 *    are the guarantee.
 *
 * 3. **Amounts are always positive.** Direction is expressed by `type`, not by
 *    a sign: a refund is an `expense` row linked back to the original expense
 *    through `refund_of_transaction_id`. That keeps one invariant — "every
 *    stored amount is > 0" — so `parseAmountToMinorUnits` and the entry form
 *    never have to reason about minus signs. Totals that must net refunds off
 *    use `NET_AMOUNT_EXPRESSION` below, which is defined exactly once.
 *
 * 4. **Nothing is ever hard-deleted if history points at it.** Categories and
 *    payment methods are deactivated (`is_active = 0`) instead of deleted, and
 *    `ON DELETE RESTRICT` makes the database refuse to break a reference.
 *
 * 5. **Dates are local calendar strings** (`YYYY-MM-DD`), so they sort and
 *    compare correctly in SQL and never shift across a time zone.
 */

/** File name for the on-device database. */
export const DATABASE_NAME = 'pesatrack.db';

/** Bump this (and add a step in migrations.ts) whenever the schema changes. */
export const DATABASE_VERSION = 1;

/**
 * SQL fragment yielding an expense amount with refunds subtracted.
 *
 * Only expense rows can be refunds (enforced below), so this reads:
 * "a normal expense counts positive, a refund counts negative".
 *
 *     SELECT SUM(${NET_AMOUNT_EXPRESSION}) AS spent
 *     FROM transactions WHERE type = 'expense' AND date BETWEEN ? AND ?
 *
 * Defined once so a query can never accidentally net refunds twice, or forget
 * to net them at all.
 */
export const NET_AMOUNT_EXPRESSION =
  '(CASE WHEN refund_of_transaction_id IS NULL THEN amount_minor_units ELSE -amount_minor_units END)';

/**
 * Migration 1: create every table, index and trigger.
 *
 * `IF NOT EXISTS` is not used on purpose — a migration should fail loudly if
 * the database is not in the state it expects, rather than silently doing
 * nothing and leaving a half-built schema behind.
 */
export const SCHEMA_V1 = `
-- ---------------------------------------------------------------------------
-- settings: exactly one row, holding app-wide preferences.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  display_name TEXT,
  currency_code TEXT NOT NULL DEFAULT 'KES',
  currency_symbol TEXT NOT NULL DEFAULT 'KSh',
  /* A financial month may start on the 1st..28th, so every month has that day. */
  financial_month_start_day INTEGER NOT NULL DEFAULT 1
    CHECK (financial_month_start_day BETWEEN 1 AND 28),
  theme_preference TEXT NOT NULL DEFAULT 'system'
    CHECK (theme_preference IN ('system', 'light', 'dark')),
  budget_warning_threshold_percent INTEGER NOT NULL DEFAULT 80
    CHECK (budget_warning_threshold_percent BETWEEN 1 AND 100),
  default_transaction_sort TEXT NOT NULL DEFAULT 'newest'
    CHECK (default_transaction_sort IN ('newest', 'oldest')),
  /* Money held before the first recorded transaction. Never counted as income. */
  starting_balance_minor_units INTEGER NOT NULL DEFAULT 0,
  /* Savings held before using PesaTrack. Never counted as income. */
  savings_opening_balance_minor_units INTEGER NOT NULL DEFAULT 0 CHECK (savings_opening_balance_minor_units >= 0),
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'saving')),
  icon TEXT,
  /* Convenience default for the entry form; the user can always override it. */
  default_need_want TEXT CHECK (default_need_want IN ('need', 'want', 'unexpected')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  /* Need/Want is an expense idea; it is null for income and savings. */
  CHECK (type = 'expense' OR default_need_want IS NULL)
);

/* "Food" and " food " are the same category: no look-alike duplicates. */
CREATE UNIQUE INDEX idx_categories_type_name
  ON categories (type, lower(trim(name)));

CREATE INDEX idx_categories_type_active ON categories(type, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- payment_methods — descriptive labels only, no bank or M-Pesa integration.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_payment_methods_name ON payment_methods (lower(trim(name)));

CREATE TABLE savings_goals (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  target_minor_units INTEGER NOT NULL CHECK (target_minor_units > 0),
  opening_balance_minor_units INTEGER NOT NULL DEFAULT 0
    CHECK (opening_balance_minor_units >= 0),
  target_date TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- transactions: the single source of truth for all money movement.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'saving')),
  /* Always positive: a refund is flagged by refund_of_transaction_id, not by a sign. */
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units > 0),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
  notes TEXT,
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  need_want TEXT CHECK (need_want IN ('need', 'want', 'unexpected')),
  payment_method_id TEXT REFERENCES payment_methods (id) ON DELETE SET NULL,
  saving_direction TEXT CHECK (saving_direction IN ('in', 'out')),
  savings_goal_id TEXT REFERENCES savings_goals (id) ON DELETE SET NULL,
  refund_of_transaction_id TEXT REFERENCES transactions (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  /* A refund is always a reversal of an expense — never of income or savings. */
  CHECK (refund_of_transaction_id IS NULL OR type = 'expense'),
  /* A transaction cannot be a refund of itself. */
  CHECK (refund_of_transaction_id IS NULL OR refund_of_transaction_id <> id),
  /* Need/Want describes spending, so it exists on expenses only. */
  CHECK (type = 'expense' OR need_want IS NULL),
  /* A saving transaction must state which way the money moved. */
  CHECK (type <> 'saving' OR saving_direction IS NOT NULL),
  /* Savings fields are meaningless on income and expense rows. */
  CHECK (type = 'saving' OR (saving_direction IS NULL AND savings_goal_id IS NULL))
);

CREATE INDEX idx_transactions_date ON transactions (date DESC, created_at DESC);
CREATE INDEX idx_transactions_type_date ON transactions (type, date);
CREATE INDEX idx_transactions_category_date ON transactions (category_id, date);
CREATE INDEX idx_transactions_payment_method ON transactions (payment_method_id);
CREATE INDEX idx_transactions_savings_goal ON transactions (savings_goal_id);
CREATE INDEX idx_transactions_refund_of ON transactions (refund_of_transaction_id);

/*
  A refund must reverse an *expense*. A CHECK constraint can only look at the
  row being written, so this rule needs a trigger. Triggers fire for every
  writer — a screen, a future import, a migration — which is what makes the rule
  a guarantee rather than a convention.

  Note the WHEN clause requires the target to exist: a refund pointing at a
  transaction that is not there at all is caught by the foreign key instead.
*/
CREATE TRIGGER trg_transactions_refund_targets_expense_insert
BEFORE INSERT ON transactions
WHEN NEW.refund_of_transaction_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM transactions
    WHERE id = NEW.refund_of_transaction_id AND type <> 'expense'
  )
BEGIN
  SELECT RAISE(ABORT, 'A refund can only reverse an expense');
END;

CREATE TRIGGER trg_transactions_refund_targets_expense_update
BEFORE UPDATE ON transactions
WHEN NEW.refund_of_transaction_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM transactions
    WHERE id = NEW.refund_of_transaction_id AND type <> 'expense'
  )
BEGIN
  SELECT RAISE(ABORT, 'A refund can only reverse an expense');
END;

/* The reverse direction: an expense that has a refund can never become income
   or savings, which would leave the refund reversing nothing. */
CREATE TRIGGER trg_transactions_refunded_expense_stays_expense
BEFORE UPDATE OF type ON transactions
WHEN NEW.type <> 'expense'
  AND EXISTS (
    SELECT 1 FROM transactions WHERE refund_of_transaction_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'An expense that has a refund cannot change type');
END;

-- ---------------------------------------------------------------------------
-- Budgets: one row per expense category per financial month.
-- A missing row means "No Budget Set" — never a budget of zero.
-- ---------------------------------------------------------------------------
CREATE TABLE monthly_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  month_key TEXT NOT NULL CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  budgeted_minor_units INTEGER NOT NULL CHECK (budgeted_minor_units > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_monthly_budgets_month_category
  ON monthly_budgets (month_key, category_id);
CREATE INDEX idx_monthly_budgets_month ON monthly_budgets (month_key);

/* Optional overall limit for a month, shown alongside per-category budgets. */
CREATE TABLE monthly_budget_totals (
  id TEXT PRIMARY KEY NOT NULL,
  month_key TEXT NOT NULL UNIQUE CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  budgeted_minor_units INTEGER NOT NULL CHECK (budgeted_minor_units > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Obligations: known upcoming bills, used by Safe-to-Spend.
-- ---------------------------------------------------------------------------
CREATE TABLE obligations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units > 0),
  due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  is_paid INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1)),
  /* Set when the obligation is settled by a recorded transaction. */
  paid_transaction_id TEXT REFERENCES transactions (id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_obligations_due_date ON obligations (due_date);
CREATE INDEX idx_obligations_paid_due ON obligations (is_paid, due_date);
`;

/**
 * The tables a JSON backup contains, and the columns it stores for each.
 *
 * Listed **parents before children**, which is the order a restore inserts them
 * in; a restore deletes them in the reverse order. The list is explicit rather
 * than read from `PRAGMA table_info` so that a future column addition is a
 * deliberate decision about the backup format rather than a silent change to it.
 *
 * Every table is included — even `obligations`, which no screen writes yet — so
 * a backup is a complete picture and nothing the schema holds is quietly lost.
 */
export type BackupTableSpec = {
  name: string;
  columns: readonly string[];
};

export const BACKUP_TABLES: readonly BackupTableSpec[] = [
  {
    name: 'categories',
    columns: [
      'id',
      'name',
      'type',
      'icon',
      'default_need_want',
      'is_default',
      'is_active',
      'sort_order',
      'created_at',
    ],
  },
  {
    name: 'payment_methods',
    columns: ['id', 'name', 'is_default', 'is_active', 'sort_order', 'created_at'],
  },
  {
    name: 'savings_goals',
    columns: [
      'id',
      'name',
      'target_minor_units',
      'opening_balance_minor_units',
      'target_date',
      'is_archived',
      'sort_order',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'transactions',
    columns: [
      'id',
      'type',
      'amount_minor_units',
      'date',
      'description',
      'notes',
      'category_id',
      'need_want',
      'payment_method_id',
      'saving_direction',
      'savings_goal_id',
      'refund_of_transaction_id',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'monthly_budgets',
    columns: [
      'id',
      'month_key',
      'category_id',
      'budgeted_minor_units',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'monthly_budget_totals',
    columns: ['id', 'month_key', 'budgeted_minor_units', 'created_at', 'updated_at'],
  },
  {
    name: 'obligations',
    columns: [
      'id',
      'name',
      'amount_minor_units',
      'due_date',
      'is_paid',
      'paid_transaction_id',
      'notes',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'settings',
    columns: [
      'id',
      'display_name',
      'currency_code',
      'currency_symbol',
      'financial_month_start_day',
      'theme_preference',
      'budget_warning_threshold_percent',
      'default_transaction_sort',
      'starting_balance_minor_units',
      'savings_opening_balance_minor_units',
      'onboarding_completed',
      'created_at',
      'updated_at',
    ],
  },
];

/**
 * The value types a backup row holds. They are exactly what a JSON file can
 * carry and what SQLite columns here use — text, integers and `NULL` — so a
 * restored value needs no conversion on the way back in.
 */
export type BackupValue = string | number | null;

/** One table row, keyed by its snake_case column names. */
export type BackupRow = Record<string, BackupValue>;

/** Every table's rows, keyed by table name. */
export type BackupTables = Record<string, BackupRow[]>;

/**
 * A category created on first launch, described without any database detail so
 * it can also be used by tests and by a future "reset to defaults" action.
 */
export type SeedCategory = {
  name: string;
  type: 'income' | 'expense' | 'saving';
  icon: string;
  defaultNeedWant: 'need' | 'want' | 'unexpected' | null;
};

/**
 * Categories created the first time the database is opened.
 *
 * They are a starting point, not a rule: every one of them can be renamed,
 * re-iconed or deactivated in Settings. `defaultNeedWant` is only a suggestion
 * that pre-selects the Need/Want field in the entry form.
 *
 * They are chosen for a Kenyan student: no categories for mortgages or car
 * loans, but ones for matatu fare, airtime and family support.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  // Expenses.
  { name: 'Food & Groceries', type: 'expense', icon: 'cart-outline', defaultNeedWant: 'need' },
  { name: 'Eating Out', type: 'expense', icon: 'fast-food-outline', defaultNeedWant: 'want' },
  { name: 'Transport', type: 'expense', icon: 'bus-outline', defaultNeedWant: 'need' },
  { name: 'Rent', type: 'expense', icon: 'home-outline', defaultNeedWant: 'need' },
  { name: 'Electricity & Water', type: 'expense', icon: 'flash-outline', defaultNeedWant: 'need' },
  { name: 'Airtime & Data', type: 'expense', icon: 'phone-portrait-outline', defaultNeedWant: 'need' },
  { name: 'School & Books', type: 'expense', icon: 'school-outline', defaultNeedWant: 'need' },
  { name: 'Health', type: 'expense', icon: 'medkit-outline', defaultNeedWant: 'need' },
  { name: 'Personal Care', type: 'expense', icon: 'body-outline', defaultNeedWant: 'need' },
  { name: 'Clothing', type: 'expense', icon: 'shirt-outline', defaultNeedWant: 'need' },
  { name: 'Entertainment', type: 'expense', icon: 'game-controller-outline', defaultNeedWant: 'want' },
  { name: 'Church & Giving', type: 'expense', icon: 'heart-outline', defaultNeedWant: 'need' },
  { name: 'Family Support', type: 'expense', icon: 'people-outline', defaultNeedWant: 'need' },
  /* Left unclassified on purpose so the form asks the user instead of assuming. */
  { name: 'Other', type: 'expense', icon: 'ellipsis-horizontal-outline', defaultNeedWant: null },

  // Income.
  { name: 'Allowance', type: 'income', icon: 'cash-outline', defaultNeedWant: null },
  { name: 'Salary', type: 'income', icon: 'briefcase-outline', defaultNeedWant: null },
  { name: 'Business', type: 'income', icon: 'storefront-outline', defaultNeedWant: null },
  { name: 'Gift', type: 'income', icon: 'gift-outline', defaultNeedWant: null },
  { name: 'Other Income', type: 'income', icon: 'ellipsis-horizontal-outline', defaultNeedWant: null },

  // Savings.
  /* A single savings category is enough — the savings goal says what it is for. */
  { name: 'Savings', type: 'saving', icon: 'archive-outline', defaultNeedWant: null },
];

/**
 * Payment methods created on first launch.
 *
 * These are labels only. PesaTrack never talks to M-Pesa or a bank, and never
 * asks for a PIN, PIN-like secret or account number.
 */
export const SEED_PAYMENT_METHODS: readonly string[] = [
  'M-Pesa',
  'Cash',
  'Bank',
  'Card',
  'Other',
];

/** Name of the payment method pre-selected for new transactions. */
export const DEFAULT_PAYMENT_METHOD_NAME = 'M-Pesa';

/** Default budget warning threshold, as a percentage of the category budget. */
export const DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT = 80;
