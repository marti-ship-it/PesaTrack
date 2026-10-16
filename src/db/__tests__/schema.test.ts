/**
 * Verifies the database schema itself.
 *
 * These tests execute `SCHEMA_V1` against a real SQLite engine — the same SQL
 * the phone runs — and then try to store rows that should be impossible. They
 * are the reason the constraints can be trusted rather than merely reviewed:
 * if someone loosens a CHECK by accident, a test here fails.
 *
 * They use `node:sqlite`, Node's built-in SQLite binding, so they need no
 * emulator, no Expo Go and no native module.
 */

import { DatabaseSync } from 'node:sqlite';

import { NET_AMOUNT_EXPRESSION, SCHEMA_V1, SEED_CATEGORIES, SEED_PAYMENT_METHODS } from '../schema';

type SqlValue = string | number | null;

const TIMESTAMP = '2026-10-15T10:00:00.000Z';

/** A fresh in-memory database with the real schema applied. */
function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_V1);
  return db;
}

function insertRow(db: DatabaseSync, table: string, row: Record<string, SqlValue>): void {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders});`
  ).run(...Object.values(row));
}

const CATEGORY_DEFAULTS: Record<string, SqlValue> = {
  id: 'cat-food',
  name: 'Food',
  type: 'expense',
  icon: null,
  default_need_want: 'need',
  is_default: 1,
  is_active: 1,
  sort_order: 0,
  created_at: TIMESTAMP,
};

const PAYMENT_METHOD_DEFAULTS: Record<string, SqlValue> = {
  id: 'pm-mpesa',
  name: 'M-Pesa',
  is_default: 1,
  is_active: 1,
  sort_order: 0,
  created_at: TIMESTAMP,
};

const TRANSACTION_DEFAULTS: Record<string, SqlValue> = {
  id: 'tx-1',
  type: 'expense',
  amount_minor_units: 100000,
  date: '2026-10-15',
  description: 'Lunch',
  notes: null,
  category_id: 'cat-food',
  need_want: 'want',
  payment_method_id: null,
  saving_direction: null,
  savings_goal_id: null,
  refund_of_transaction_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

function insertCategory(db: DatabaseSync, overrides: Record<string, SqlValue> = {}): void {
  insertRow(db, 'categories', { ...CATEGORY_DEFAULTS, ...overrides });
}

function insertTransaction(db: DatabaseSync, overrides: Record<string, SqlValue> = {}): void {
  insertRow(db, 'transactions', { ...TRANSACTION_DEFAULTS, ...overrides });
}

describe('schema', () => {
  it('creates every table the app needs', () => {
    const db = createDatabase();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      'categories',
      'monthly_budget_totals',
      'monthly_budgets',
      'obligations',
      'payment_methods',
      'savings_goals',
      'settings',
      'transactions',
    ]);
  });

  it('creates the indexes used for filtering and reporting', () => {
    const db = createDatabase();

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%';")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toContain('idx_transactions_date');
    expect(indexes).toContain('idx_transactions_category_date');
    expect(indexes).toContain('idx_monthly_budgets_month_category');
    expect(indexes).toContain('idx_obligations_paid_due');
  });

  it('stores every seeded category and payment method', () => {
    const db = createDatabase();

    // If a seed row broke a constraint, the app would fail on first launch.
    // This proves each one is storable.
    for (const [index, category] of SEED_CATEGORIES.entries()) {
      insertCategory(db, {
        id: `seed-${index}`,
        name: category.name,
        type: category.type,
        icon: category.icon,
        default_need_want: category.defaultNeedWant,
      });
    }

    for (const [index, name] of SEED_PAYMENT_METHODS.entries()) {
      insertRow(db, 'payment_methods', {
        ...PAYMENT_METHOD_DEFAULTS,
        id: `pm-${index}`,
        name,
      });
    }

    const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories;').get() as {
      count: number;
    };
    const methodCount = db.prepare('SELECT COUNT(*) AS count FROM payment_methods;').get() as {
      count: number;
    };

    expect(categoryCount.count).toBe(SEED_CATEGORIES.length);
    expect(methodCount.count).toBe(SEED_PAYMENT_METHODS.length);
  });

  it('gives every seeded category a Need/Want only when it is an expense', () => {
    for (const category of SEED_CATEGORIES) {
      if (category.type === 'expense') {
        continue;
      }
      expect(category.defaultNeedWant).toBeNull();
    }
  });
});

describe('transaction type rules', () => {
  it('accepts a normal expense', () => {
    const db = createDatabase();
    insertCategory(db);
    expect(() => insertTransaction(db)).not.toThrow();
  });

  it('accepts income and savings with the right extra fields', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-salary', name: 'Salary', type: 'income', default_need_want: null });
    insertCategory(db, { id: 'cat-savings', name: 'Savings', type: 'saving', default_need_want: null });

    expect(() =>
      insertTransaction(db, { type: 'income', id: 'tx-income', category_id: 'cat-salary', need_want: null })
    ).not.toThrow();

    expect(() =>
      insertTransaction(db, {
        type: 'saving',
        id: 'tx-saving',
        category_id: 'cat-savings',
        need_want: null,
        saving_direction: 'in',
      })
    ).not.toThrow();
  });

  it('refuses a Need/Want on income or savings', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-salary', name: 'Salary', type: 'income', default_need_want: null });

    expect(() =>
      insertTransaction(db, { type: 'income', category_id: 'cat-salary', need_want: 'need' })
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a saving transaction without a direction', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-savings', name: 'Savings', type: 'saving', default_need_want: null });

    expect(() =>
      insertTransaction(db, {
        type: 'saving',
        category_id: 'cat-savings',
        need_want: null,
        saving_direction: null,
      })
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a savings direction on an expense', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { saving_direction: 'in' })).toThrow(
      /CHECK constraint failed/
    );
  });

  it('refuses an unknown transaction type', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { type: 'transfer' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a Need/Want value that is not need, want or unexpected', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { need_want: 'urgent' })).toThrow(/CHECK constraint failed/);
  });
});

describe('amount and description rules', () => {
  it('refuses a zero or negative amount', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { amount_minor_units: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => insertTransaction(db, { amount_minor_units: -100 })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a blank description', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { description: '   ' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() => insertTransaction(db, { date: '15/10/2026' })).toThrow(/CHECK constraint failed/);
    expect(() => insertTransaction(db, { date: '2026-1-5' })).toThrow(/CHECK constraint failed/);
  });
});

describe('refund rules', () => {
  it('accepts a refund that points at an expense', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db, { id: 'tx-original' });

    expect(() =>
      insertTransaction(db, {
        id: 'tx-refund',
        refund_of_transaction_id: 'tx-original',
        description: 'Refund of lunch',
      })
    ).not.toThrow();
  });

  it('refuses a refund of income', () => {
    const db = createDatabase();
    insertCategory(db); // the expense category the refund itself uses
    insertCategory(db, { id: 'cat-salary', name: 'Salary', type: 'income', default_need_want: null });
    insertTransaction(db, {
      id: 'tx-income',
      type: 'income',
      category_id: 'cat-salary',
      need_want: null,
    });

    // A CHECK constraint cannot inspect another row, so this is a trigger.
    expect(() =>
      insertTransaction(db, { id: 'tx-refund', refund_of_transaction_id: 'tx-income' })
    ).toThrow(/A refund can only reverse an expense/);
  });

  it('refuses to point an existing transaction at income as a refund', () => {
    const db = createDatabase();
    insertCategory(db);
    insertCategory(db, { id: 'cat-salary', name: 'Salary', type: 'income', default_need_want: null });
    insertTransaction(db, { id: 'tx-original' });
    insertTransaction(db, { id: 'tx-income', type: 'income', category_id: 'cat-salary', need_want: null });

    expect(() =>
      db
        .prepare('UPDATE transactions SET refund_of_transaction_id = ? WHERE id = ?;')
        .run('tx-income', 'tx-original')
    ).toThrow(/A refund can only reverse an expense/);
  });

  it('refuses to turn a refunded expense into income', () => {
    const db = createDatabase();
    insertCategory(db);
    insertCategory(db, { id: 'cat-salary', name: 'Salary', type: 'income', default_need_want: null });
    insertTransaction(db, { id: 'tx-original' });
    insertTransaction(db, {
      id: 'tx-refund',
      amount_minor_units: 25000,
      refund_of_transaction_id: 'tx-original',
      description: 'Refund',
    });

    expect(() =>
      db.prepare('UPDATE transactions SET type = ? WHERE id = ?;').run('income', 'tx-original')
    ).toThrow(/An expense that has a refund cannot change type/);
  });

  it('refuses a transaction that is a refund of itself', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() =>
      insertTransaction(db, { id: 'tx-self', refund_of_transaction_id: 'tx-self' })
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a refund pointing at a transaction that does not exist', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() =>
      insertTransaction(db, { refund_of_transaction_id: 'tx-missing' })
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('nets refunds off when totalling spending', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db, { id: 'tx-original', amount_minor_units: 100000 });
    insertTransaction(db, {
      id: 'tx-refund',
      amount_minor_units: 40000,
      refund_of_transaction_id: 'tx-original',
      description: 'Refund of lunch',
    });

    const gross = db
      .prepare('SELECT SUM(amount_minor_units) AS total FROM transactions WHERE type = ?;')
      .get('expense') as { total: number };

    const net = db
      .prepare(
        `SELECT SUM(${NET_AMOUNT_EXPRESSION}) AS total FROM transactions WHERE type = ?;`
      )
      .get('expense') as { total: number };

    // The gross figure is the trap this fragment exists to avoid: it would
    // report KSh 1,400 of spending for what actually cost KSh 600.
    expect(gross.total).toBe(140000);
    expect(net.total).toBe(60000);
  });

  it('lets a fully refunded expense net to zero without touching income', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db, { id: 'tx-original', amount_minor_units: 25000 });
    insertTransaction(db, {
      id: 'tx-refund',
      amount_minor_units: 25000,
      refund_of_transaction_id: 'tx-original',
      description: 'Refund',
    });

    const net = db
      .prepare(`SELECT SUM(${NET_AMOUNT_EXPRESSION}) AS total FROM transactions WHERE type = 'expense';`)
      .get() as { total: number };

    expect(net.total).toBe(0);
  });
});

describe('category and payment method rules', () => {
  it('refuses two categories with the same name in the same type', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-1', name: 'Food' });

    expect(() => insertCategory(db, { id: 'cat-2', name: 'Food' })).toThrow(
      /UNIQUE constraint failed/
    );
  });

  it('treats names as equal regardless of case and surrounding spaces', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-1', name: 'Food' });

    // Otherwise the picker could show "Food" and " food " as two categories.
    expect(() => insertCategory(db, { id: 'cat-2', name: ' food ' })).toThrow(
      /UNIQUE constraint failed/
    );
  });

  it('allows the same name for different transaction types', () => {
    const db = createDatabase();
    insertCategory(db, { id: 'cat-1', name: 'Other', type: 'expense', default_need_want: null });
    insertCategory(db, { id: 'cat-2', name: 'Other', type: 'income', default_need_want: null });

    const count = db.prepare('SELECT COUNT(*) AS count FROM categories;').get() as { count: number };
    expect(count.count).toBe(2);
  });

  it('refuses a Need/Want suggestion on a non-expense category', () => {
    const db = createDatabase();

    expect(() =>
      insertCategory(db, { type: 'income', default_need_want: 'need' })
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a blank category name', () => {
    const db = createDatabase();
    expect(() => insertCategory(db, { name: '  ' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses duplicate payment method names, ignoring case', () => {
    const db = createDatabase();
    insertRow(db, 'payment_methods', PAYMENT_METHOD_DEFAULTS);

    expect(() =>
      insertRow(db, 'payment_methods', { ...PAYMENT_METHOD_DEFAULTS, id: 'pm-2', name: 'm-pesa' })
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe('referential integrity', () => {
  it('refuses a transaction whose category does not exist', () => {
    const db = createDatabase();

    expect(() => insertTransaction(db, { category_id: 'cat-missing' })).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('refuses to delete a category that transactions still use', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db);

    // ON DELETE RESTRICT: history must keep a real category.
    expect(() => db.prepare('DELETE FROM categories WHERE id = ?;').run('cat-food')).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('refuses to delete an expense that has a refund against it', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db, { id: 'tx-original' });
    insertTransaction(db, { id: 'tx-refund', refund_of_transaction_id: 'tx-original' });

    expect(() => db.prepare('DELETE FROM transactions WHERE id = ?;').run('tx-original')).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('keeps a retired payment method usable by old transactions', () => {
    const db = createDatabase();
    insertCategory(db);
    insertRow(db, 'payment_methods', PAYMENT_METHOD_DEFAULTS);
    insertTransaction(db, { payment_method_id: 'pm-mpesa' });

    // Retiring is a soft delete: the label survives for history.
    db.prepare('UPDATE payment_methods SET is_active = 0 WHERE id = ?;').run('pm-mpesa');

    const row = db.prepare('SELECT payment_method_id FROM transactions WHERE id = ?;').get('tx-1') as {
      payment_method_id: string;
    };
    expect(row.payment_method_id).toBe('pm-mpesa');
  });
});

describe('budget rules', () => {
  it("stores one budget per category per month", () => {
    const db = createDatabase();
    insertCategory(db);
    insertRow(db, 'monthly_budgets', {
      id: 'budget-1',
      month_key: '2026-10',
      category_id: 'cat-food',
      budgeted_minor_units: 1500000,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });

    expect(() =>
      insertRow(db, 'monthly_budgets', {
        id: 'budget-2',
        month_key: '2026-10',
        category_id: 'cat-food',
        budgeted_minor_units: 200000,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      })
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('refuses a budget of zero, because that means "no budget set"', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() =>
      insertRow(db, 'monthly_budgets', {
        id: 'budget-1',
        month_key: '2026-10',
        category_id: 'cat-food',
        budgeted_minor_units: 0,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      })
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a malformed month key', () => {
    const db = createDatabase();
    insertCategory(db);

    expect(() =>
      insertRow(db, 'monthly_budgets', {
        id: 'budget-1',
        month_key: 'October 2026',
        category_id: 'cat-food',
        budgeted_minor_units: 1000,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      })
    ).toThrow(/CHECK constraint failed/);
  });

  it('allows only one overall monthly limit per month', () => {
    const db = createDatabase();

    const total = {
      id: 'total-1',
      month_key: '2026-10',
      budgeted_minor_units: 3000000,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    };

    insertRow(db, 'monthly_budget_totals', total);
    expect(() => insertRow(db, 'monthly_budget_totals', { ...total, id: 'total-2' })).toThrow(
      /UNIQUE constraint failed/
    );
  });
});

describe('settings row', () => {
  const settingsRow = (overrides: Record<string, SqlValue> = {}): Record<string, SqlValue> => ({
    id: 1,
    display_name: null,
    currency_code: 'KES',
    currency_symbol: 'KSh',
    financial_month_start_day: 1,
    theme_preference: 'system',
    budget_warning_threshold_percent: 80,
    default_transaction_sort: 'newest',
    starting_balance_minor_units: 0,
    savings_opening_balance_minor_units: 0,
    onboarding_completed: 0,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  });

  it('accepts exactly one row', () => {
    const db = createDatabase();
    insertRow(db, 'settings', settingsRow());

    const count = db.prepare('SELECT COUNT(*) AS count FROM settings;').get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('refuses a second settings row', () => {
    const db = createDatabase();
    insertRow(db, 'settings', settingsRow());

    expect(() => insertRow(db, 'settings', settingsRow({ id: 2 }))).toThrow(
      /CHECK constraint failed/
    );
  });

  it('refuses a financial month start day outside 1–28', () => {
    const db = createDatabase();

    // Day 29+ does not exist in every month, so it can never be a valid start.
    expect(() => insertRow(db, 'settings', settingsRow({ financial_month_start_day: 29 }))).toThrow(
      /CHECK constraint failed/
    );
    expect(() => insertRow(db, 'settings', settingsRow({ financial_month_start_day: 0 }))).toThrow(
      /CHECK constraint failed/
    );
  });

  it('refuses a warning threshold outside 1–100', () => {
    const db = createDatabase();

    expect(() =>
      insertRow(db, 'settings', settingsRow({ budget_warning_threshold_percent: 0 }))
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertRow(db, 'settings', settingsRow({ budget_warning_threshold_percent: 101 }))
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses an unknown theme preference or sort order', () => {
    const db = createDatabase();

    expect(() => insertRow(db, 'settings', settingsRow({ theme_preference: 'sepia' }))).toThrow(
      /CHECK constraint failed/
    );
    expect(() =>
      insertRow(db, 'settings', settingsRow({ default_transaction_sort: 'cheapest' }))
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('obligations', () => {
  const obligationRow = (overrides: Record<string, SqlValue> = {}): Record<string, SqlValue> => ({
    id: 'ob-1',
    name: 'Rent',
    amount_minor_units: 1500000,
    due_date: '2026-11-01',
    is_paid: 0,
    paid_transaction_id: null,
    notes: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  });

  it('accepts an upcoming bill', () => {
    const db = createDatabase();
    expect(() => insertRow(db, 'obligations', obligationRow())).not.toThrow();
  });

  it('refuses a zero amount or a malformed due date', () => {
    const db = createDatabase();

    expect(() => insertRow(db, 'obligations', obligationRow({ amount_minor_units: 0 }))).toThrow(
      /CHECK constraint failed/
    );
    expect(() => insertRow(db, 'obligations', obligationRow({ due_date: '1 Nov 2026' }))).toThrow(
      /CHECK constraint failed/
    );
  });

  it('keeps the bill when the transaction that paid it is removed', () => {
    const db = createDatabase();
    insertCategory(db);
    insertTransaction(db, { id: 'tx-rent' });
    insertRow(db, 'obligations', obligationRow({ is_paid: 1, paid_transaction_id: 'tx-rent' }));

    // ON DELETE SET NULL: the obligation survives, marked unpaid.
    db.prepare('DELETE FROM transactions WHERE id = ?;').run('tx-rent');

    const row = db.prepare('SELECT paid_transaction_id FROM obligations WHERE id = ?;').get('ob-1') as {
      paid_transaction_id: string | null;
    };
    expect(row.paid_transaction_id).toBeNull();
  });
});
