/**
 * Verifies the savings-goal repository and the withdrawal guard against a real
 * SQLite engine — the same SQL the phone runs.
 *
 * Three things are pinned here that the pure tests in `services/savings.ts`
 * cannot reach:
 *
 *   1. **A goal's balance is derived from its linked transactions**, so the
 *      grouped `contributionsByGoal` query must net "in" against "out" and stop
 *      at the goal boundary. This is the arithmetic the whole feature rests on.
 *   2. **A withdrawal may only take out money the goal holds**, and the balance
 *      handed to the validator must be loaded from the database.
 *   3. **Editing a withdrawal must not be blocked by its own old amount**, which
 *      is the one genuinely subtle case: the row being corrected has to be
 *      subtracted out of its own balance first.
 *
 * It uses `node:sqlite` like `schema.test.ts` and `budgets.test.ts`, so no
 * emulator or native module is needed — the only bridge is a thin adapter
 * exposing the async methods the repositories call.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

import { buildValidationContext, saveTransaction } from '@/services/transactions';
import type { TransactionDraft } from '@/services/validation';

import { getTransactionById } from '../repositories/transactions';
import {
  contributedMinorUnitsForGoal,
  contributionsByGoal,
  createSavingsGoal,
  getSavingsGoalById,
  listSavingsGoals,
  setSavingsGoalArchived,
  updateSavingsGoal,
} from '../repositories/savings-goals';
import { SCHEMA_V1 } from '../schema';

// `createSavingsGoal` generates ids through `expo-crypto`. Without the native
// module `randomUUID` yields nothing bindable, so the INSERT would fail with a
// driver error rather than a useful message.
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

function insertCategory(handle: DatabaseSync, id: string, name: string, type: string): void {
  handle
    .prepare(
      `INSERT INTO categories (
         id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at
       ) VALUES (?, ?, ?, NULL, NULL, 0, 1, 0, ?);`
    )
    .run(id, name, type, TIMESTAMP);
}

type TransactionFixture = {
  id: string;
  type: 'income' | 'expense' | 'saving';
  amountMinorUnits: number;
  categoryId: string;
  savingDirection?: 'in' | 'out' | null;
  savingsGoalId?: string | null;
};

/** Writes a transaction row directly, so a balance can be built up quickly. */
function insertTransaction(handle: DatabaseSync, fixture: TransactionFixture): void {
  handle
    .prepare(
      `INSERT INTO transactions (
         id, type, amount_minor_units, date, description, notes, category_id, need_want,
         payment_method_id, saving_direction, savings_goal_id, refund_of_transaction_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, '2026-10-15', 'Test row', NULL, ?, NULL, NULL, ?, ?, NULL, ?, ?);`
    )
    .run(
      fixture.id,
      fixture.type,
      fixture.amountMinorUnits,
      fixture.categoryId,
      fixture.savingDirection ?? null,
      fixture.savingsGoalId ?? null,
      TIMESTAMP,
      TIMESTAMP
    );
}

const SAVINGS_CATEGORY = 'cat-savings';

function savingDraft(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    type: 'saving',
    amount: '1000',
    date: '2026-10-15',
    description: 'Contribution',
    notes: null,
    categoryId: SAVINGS_CATEGORY,
    needWant: null,
    paymentMethodId: null,
    savingDirection: 'in',
    savingsGoalId: null,
    refundOfTransactionId: null,
    ...overrides,
  };
}

describe('savings goal repository', () => {
  it('creates a goal and reads it back', async () => {
    const { db } = createHarness();

    const created = await createSavingsGoal(db, {
      name: '  Emergency fund  ',
      targetMinorUnits: 5000000,
      openingBalanceMinorUnits: 2000,
      targetDate: '2026-12-31',
    });

    expect(created.name).toBe('Emergency fund');
    expect(created.targetMinorUnits).toBe(5000000);
    expect(created.openingBalanceMinorUnits).toBe(2000);
    expect(created.targetDate).toBe('2026-12-31');
    expect(created.isArchived).toBe(false);

    await expect(getSavingsGoalById(db, created.id)).resolves.toEqual(created);
  });

  it('returns null for an unknown goal id', async () => {
    const { db } = createHarness();

    await expect(getSavingsGoalById(db, 'goal-missing')).resolves.toBeNull();
  });

  it('lists active goals only by default, and archived ones when asked', async () => {
    const { db } = createHarness();
    const active = await createSavingsGoal(db, { name: 'Phone', targetMinorUnits: 3000000 });
    const retired = await createSavingsGoal(db, { name: 'Old goal', targetMinorUnits: 100000 });

    await setSavingsGoalArchived(db, retired.id, true);

    const defaults = await listSavingsGoals(db);
    expect(defaults.map((goal) => goal.id)).toEqual([active.id]);

    const all = await listSavingsGoals(db, { includeArchived: true });
    expect(all.map((goal) => goal.id).sort()).toEqual([active.id, retired.id].sort());
  });

  it('updates the target and date without touching the opening balance', async () => {
    const { db } = createHarness();
    const goal = await createSavingsGoal(db, {
      name: 'Emergency fund',
      targetMinorUnits: 5000000,
      openingBalanceMinorUnits: 2000,
    });

    const updated = await updateSavingsGoal(db, goal.id, {
      name: 'Rainy day fund',
      targetMinorUnits: 3000000,
      targetDate: '2027-01-31',
    });

    expect(updated.name).toBe('Rainy day fund');
    expect(updated.targetMinorUnits).toBe(3000000);
    expect(updated.targetDate).toBe('2027-01-31');
    expect(updated.openingBalanceMinorUnits).toBe(2000);
  });

  it('archives and restores without losing the goal', async () => {
    const { db } = createHarness();
    const goal = await createSavingsGoal(db, { name: 'Laptop', targetMinorUnits: 8000000 });

    const archived = await setSavingsGoalArchived(db, goal.id, true);
    expect(archived.isArchived).toBe(true);

    const restored = await setSavingsGoalArchived(db, goal.id, false);
    expect(restored.isArchived).toBe(false);
  });

  it('nets contributions in and out, per goal', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const emergency = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });
    const phone = await createSavingsGoal(db, { name: 'Phone', targetMinorUnits: 3000000 });

    insertTransaction(handle, {
      id: 'tx-in-1',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: emergency.id,
    });
    insertTransaction(handle, {
      id: 'tx-out-1',
      type: 'saving',
      amountMinorUnits: 25000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'out',
      savingsGoalId: emergency.id,
    });
    insertTransaction(handle, {
      id: 'tx-in-2',
      type: 'saving',
      amountMinorUnits: 50000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: phone.id,
    });

    await expect(contributionsByGoal(db)).resolves.toEqual({
      [emergency.id]: 75000,
      [phone.id]: 50000,
    });
    await expect(contributedMinorUnitsForGoal(db, emergency.id)).resolves.toBe(75000);
  });

  it('ignores saving transactions with no goal, and non-saving rows', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    insertCategory(handle, 'cat-food', 'Food', 'expense');
    await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    // Money moved into savings with no particular goal.
    insertTransaction(handle, {
      id: 'tx-unlinked',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: null,
    });
    // A plain expense can never carry a goal.
    insertTransaction(handle, {
      id: 'tx-expense',
      type: 'expense',
      amountMinorUnits: 50000,
      categoryId: 'cat-food',
    });

    await expect(contributionsByGoal(db)).resolves.toEqual({});
  });
});

describe('buildValidationContext — withdrawal balance', () => {
  it('counts the opening balance plus the net contributions', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, {
      name: 'Emergency',
      targetMinorUnits: 5000000,
      openingBalanceMinorUnits: 20000,
    });

    insertTransaction(handle, {
      id: 'tx-in',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: goal.id,
    });

    const context = await buildValidationContext(
      db,
      savingDraft({ savingDirection: 'out', savingsGoalId: goal.id })
    );

    // KSh 200 opening + KSh 1,000 contributed.
    expect(context.savingsGoalBalanceMinorUnits).toBe(120000);
  });

  it('excludes the withdrawal being edited from its own balance', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    // KSh 1,000 in, then KSh 400 back out: the goal holds KSh 600.
    insertTransaction(handle, {
      id: 'tx-in',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: goal.id,
    });
    insertTransaction(handle, {
      id: 'tx-out',
      type: 'saving',
      amountMinorUnits: 40000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'out',
      savingsGoalId: goal.id,
    });

    const current = await getTransactionById(db, 'tx-out');
    if (!current) {
      throw new Error('The withdrawal fixture was not stored.');
    }

    const context = await buildValidationContext(
      db,
      savingDraft({ savingDirection: 'out', savingsGoalId: goal.id, amount: '900' }),
      current
    );

    // The KSh 400 already withdrawn is added back, so raising it to KSh 900 is
    // measured against the full KSh 1,000 the goal holds.
    expect(context.savingsGoalBalanceMinorUnits).toBe(100000);
  });

  it('is absent for a contribution, where no amount is too large', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    const context = await buildValidationContext(
      db,
      savingDraft({ savingDirection: 'in', savingsGoalId: goal.id })
    );

    expect(context.savingsGoalBalanceMinorUnits).toBeUndefined();
  });

  it('never reads a balance below zero', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    const context = await buildValidationContext(
      db,
      savingDraft({ savingDirection: 'out', savingsGoalId: goal.id })
    );

    expect(context.savingsGoalBalanceMinorUnits).toBe(0);
  });
});

describe('saveTransaction — refusing an over-large withdrawal', () => {
  it('accepts a withdrawal within the balance and stores it', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    insertTransaction(handle, {
      id: 'tx-in',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: goal.id,
    });

    const result = await saveTransaction(
      db,
      savingDraft({
        amount: '600',
        description: 'Withdrawal from Emergency',
        savingDirection: 'out',
        savingsGoalId: goal.id,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.savingsGoalId).toBe(goal.id);
    expect(result.value.savingDirection).toBe('out');
    expect(result.value.amountMinorUnits).toBe(60000);
  });

  it('refuses a withdrawal larger than the goal holds, writing nothing', async () => {
    const { handle, db } = createHarness();
    insertCategory(handle, SAVINGS_CATEGORY, 'Savings', 'saving');
    const goal = await createSavingsGoal(db, { name: 'Emergency', targetMinorUnits: 5000000 });

    insertTransaction(handle, {
      id: 'tx-in',
      type: 'saving',
      amountMinorUnits: 100000,
      categoryId: SAVINGS_CATEGORY,
      savingDirection: 'in',
      savingsGoalId: goal.id,
    });

    const result = await saveTransaction(
      db,
      savingDraft({
        amount: '1000.01',
        description: 'Withdrawal from Emergency',
        savingDirection: 'out',
        savingsGoalId: goal.id,
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toContain('more than');

    // Nothing was written: the goal still holds exactly the KSh 1,000 it had.
    await expect(contributedMinorUnitsForGoal(db, goal.id)).resolves.toBe(100000);
  });
});
