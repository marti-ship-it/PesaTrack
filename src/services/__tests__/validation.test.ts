import type { Category, PaymentMethod, SavingsGoal, Transaction } from '@/types/models';

import {
  createEmptyDraft,
  validateTransactionDraft,
} from '../validation';

/**
 * These tests are the executable version of the app's money rules. They run
 * without a database or a phone, so they cover the awkward cases — a refund
 * larger than the original expense, an expense category used for income, a
 * retired category — that are tedious to reproduce by hand.
 */

function category(overrides: Partial<Category> & Pick<Category, 'id' | 'type'>): Category {
  return {
    name: overrides.id,
    icon: null,
    defaultNeedWant: overrides.type === 'expense' ? 'need' : null,
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function paymentMethod(overrides: Partial<PaymentMethod> & Pick<PaymentMethod, 'id'>): PaymentMethod {
  return {
    name: overrides.id,
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function savingsGoal(overrides: Partial<SavingsGoal> & Pick<SavingsGoal, 'id'>): SavingsGoal {
  return {
    name: overrides.id,
    targetMinorUnits: 5000000,
    openingBalanceMinorUnits: 0,
    targetDate: null,
    isArchived: false,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function transaction(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    type: 'expense',
    amountMinorUnits: 100000,
    date: '2026-10-10',
    description: 'Shopping',
    notes: null,
    categoryId: 'cat-food',
    needWant: 'want',
    paymentMethodId: null,
    savingDirection: null,
    savingsGoalId: null,
    refundOfTransactionId: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
  };
}

const FOOD = category({ id: 'cat-food', type: 'expense', name: 'Food & Groceries' });
const TRANSPORT = category({ id: 'cat-transport', type: 'expense', name: 'Transport' });
const SALARY = category({ id: 'cat-salary', type: 'income', name: 'Salary' });
const SAVINGS = category({ id: 'cat-savings', type: 'saving', name: 'Savings' });
const M_PESA = paymentMethod({ id: 'pm-mpesa', name: 'M-Pesa', isDefault: true });

function baseContext() {
  return {
    categories: [FOOD, TRANSPORT, SALARY, SAVINGS],
    paymentMethods: [M_PESA],
  };
}

/**
 * A draft for a KSh 1,250.50 expense — the common case, so each test can
 * override just the field it is about.
 */
function draft(overrides: Partial<Parameters<typeof validateTransactionDraft>[0]> = {}) {
  return {
    ...createEmptyDraft('2026-10-15'),
    type: 'expense' as const,
    amount: '1250.50',
    description: 'Lunch',
    categoryId: FOOD.id,
    needWant: 'want' as const,
    paymentMethodId: M_PESA.id,
    ...overrides,
  };
}

/** Collects the error keys so a test can assert on the fields that failed. */
function failedFields(result: ReturnType<typeof validateTransactionDraft>): string[] {
  return result.ok ? [] : Object.keys(result.errors).sort();
}

describe('validateTransactionDraft — accepted input', () => {
  it('accepts a complete expense and converts it to minor units', () => {
    const result = validateTransactionDraft(draft(), baseContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      type: 'expense',
      amountMinorUnits: 125050,
      date: '2026-10-15',
      description: 'Lunch',
      notes: null,
      categoryId: FOOD.id,
      needWant: 'want',
      paymentMethodId: M_PESA.id,
      savingDirection: null,
      savingsGoalId: null,
      refundOfTransactionId: null,
    });
  });

  it('trims the description and turns blank notes into null', () => {
    const result = validateTransactionDraft(
      draft({ description: '  Matatu to college  ', notes: '   ' }),
      baseContext()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe('Matatu to college');
    expect(result.value.notes).toBeNull();
  });

  it('accepts income without a Need/Want, and without a payment method', () => {
    const result = validateTransactionDraft(
      draft({ type: 'income', categoryId: SALARY.id, needWant: null, paymentMethodId: null }),
      baseContext()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needWant).toBeNull();
    expect(result.value.paymentMethodId).toBeNull();
  });

  it('accepts a savings contribution with a direction', () => {
    const result = validateTransactionDraft(
      draft({
        type: 'saving',
        categoryId: SAVINGS.id,
        needWant: null,
        savingDirection: 'in',
      }),
      baseContext()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.savingDirection).toBe('in');
  });

  it('accepts a savings withdrawal', () => {
    const result = validateTransactionDraft(
      draft({ type: 'saving', categoryId: SAVINGS.id, needWant: null, savingDirection: 'out' }),
      baseContext()
    );

    expect(result.ok).toBe(true);
  });
});

describe('validateTransactionDraft — required fields', () => {
  it('requires a type', () => {
    expect(failedFields(validateTransactionDraft(draft({ type: null }), baseContext()))).toContain(
      'type'
    );
  });

  it('rejects an amount that is not a valid number', () => {
    expect(failedFields(validateTransactionDraft(draft({ amount: '12.345' }), baseContext()))).toContain(
      'amount'
    );
    expect(failedFields(validateTransactionDraft(draft({ amount: 'abc' }), baseContext()))).toContain(
      'amount'
    );
    expect(failedFields(validateTransactionDraft(draft({ amount: '' }), baseContext()))).toContain(
      'amount'
    );
  });

  it('rejects an amount of zero', () => {
    const result = validateTransactionDraft(draft({ amount: '0' }), baseContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toMatch(/more than zero/i);
  });

  it('requires a description', () => {
    expect(
      failedFields(validateTransactionDraft(draft({ description: '   ' }), baseContext()))
    ).toContain('description');
  });

  it('rejects an over-long description', () => {
    const result = validateTransactionDraft(
      draft({ description: 'x'.repeat(121) }),
      baseContext()
    );
    expect(failedFields(result)).toContain('description');
  });

  it('rejects notes longer than the limit', () => {
    const result = validateTransactionDraft(
      draft({ notes: 'n'.repeat(501) }),
      baseContext()
    );
    expect(failedFields(result)).toContain('notes');
  });

  it('rejects an impossible date', () => {
    expect(failedFields(validateTransactionDraft(draft({ date: '2026-02-30' }), baseContext()))).toContain(
      'date'
    );
  });

  it('reports every problem at once, so the form can show them together', () => {
    const result = validateTransactionDraft(
      draft({ amount: 'abc', description: '', categoryId: null, needWant: null }),
      baseContext()
    );

    expect(failedFields(result)).toEqual(['amount', 'categoryId', 'description', 'needWant']);
  });
});

describe('validateTransactionDraft — categories are enforced, not just hidden', () => {
  it('rejects a category that does not exist', () => {
    expect(
      failedFields(validateTransactionDraft(draft({ categoryId: 'nope' }), baseContext()))
    ).toContain('categoryId');
  });

  it('rejects an expense category chosen for income', () => {
    const result = validateTransactionDraft(
      draft({ type: 'income', categoryId: FOOD.id, needWant: null }),
      baseContext()
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.categoryId).toContain('cannot be used for income');
  });

  it('rejects an income category chosen for an expense', () => {
    const result = validateTransactionDraft(draft({ type: 'expense', categoryId: SALARY.id }), baseContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.categoryId).toContain('cannot be used for expense');
  });

  it('rejects a retired category on a new transaction', () => {
    const retired = category({ id: 'cat-retired', name: 'Old Hobby', type: 'expense', isActive: false });
    const context = { ...baseContext(), categories: [FOOD, retired] };

    const result = validateTransactionDraft(draft({ categoryId: retired.id }), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.categoryId).toContain('retired');
  });

  it('still allows a retired category on the transaction that already uses it', () => {
    const retired = category({ id: 'cat-retired', name: 'Old Hobby', type: 'expense', isActive: false });
    const context = {
      ...baseContext(),
      categories: [FOOD, retired],
      currentCategoryId: retired.id,
    };

    // Editing an old transaction must not force the user to rewrite history.
    expect(validateTransactionDraft(draft({ categoryId: retired.id }), context).ok).toBe(true);
  });
});

describe('validateTransactionDraft — Need / Want / Unexpected', () => {
  it('requires a Need/Want for an expense', () => {
    const result = validateTransactionDraft(draft({ needWant: null }), baseContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.needWant).toBeDefined();
  });

  it('clears a Need/Want sent with income or savings, since neither has one', () => {
    const income = validateTransactionDraft(
      draft({ type: 'income', categoryId: SALARY.id, needWant: 'want' }),
      baseContext()
    );
    const saving = validateTransactionDraft(
      draft({ type: 'saving', categoryId: SAVINGS.id, needWant: 'want', savingDirection: 'in' }),
      baseContext()
    );

    expect(income.ok && income.value.needWant).toBeNull();
    expect(saving.ok && saving.value.needWant).toBeNull();
  });

  it('accepts "unexpected" as a classification', () => {
    const result = validateTransactionDraft(draft({ needWant: 'unexpected' }), baseContext());
    expect(result.ok && result.value.needWant).toBe('unexpected');
  });
});

describe('validateTransactionDraft — payment methods', () => {
  it('rejects a payment method that does not exist', () => {
    expect(
      failedFields(validateTransactionDraft(draft({ paymentMethodId: 'nope' }), baseContext()))
    ).toContain('paymentMethodId');
  });

  it('rejects a retired payment method on a new transaction', () => {
    const retired = paymentMethod({ id: 'pm-old', name: 'Old Wallet', isActive: false });
    const context = { ...baseContext(), paymentMethods: [M_PESA, retired] };

    const result = validateTransactionDraft(draft({ paymentMethodId: retired.id }), context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.paymentMethodId).toContain('retired');
  });
});

describe('validateTransactionDraft — savings', () => {
  it('requires a direction for a saving transaction', () => {
    const result = validateTransactionDraft(
      draft({ type: 'saving', categoryId: SAVINGS.id, needWant: null, savingDirection: null }),
      baseContext()
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.savingDirection).toBeDefined();
  });

  it('rejects a savings goal that no longer exists', () => {
    const result = validateTransactionDraft(
      draft({
        type: 'saving',
        categoryId: SAVINGS.id,
        needWant: null,
        savingDirection: 'in',
        savingsGoalId: 'goal-gone',
      }),
      { ...baseContext(), savingsGoals: [] }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.savingsGoalId).toBeDefined();
  });

  describe('withdrawals', () => {
    const EMERGENCY = savingsGoal({ id: 'goal-1', name: 'Emergency fund' });

    function withdrawalDraft(
      overrides: Partial<Parameters<typeof validateTransactionDraft>[0]> = {}
    ) {
      return draft({
        type: 'saving',
        categoryId: SAVINGS.id,
        needWant: null,
        savingDirection: 'out',
        savingsGoalId: EMERGENCY.id,
        description: 'Withdrawal from Emergency fund',
        ...overrides,
      });
    }

    function withdrawalContext(balanceMinorUnits: number) {
      return {
        ...baseContext(),
        savingsGoals: [EMERGENCY],
        savingsGoalBalanceMinorUnits: balanceMinorUnits,
      };
    }

    it('accepts a withdrawal within the goal balance', () => {
      // KSh 500 out of KSh 1,000 held.
      const result = validateTransactionDraft(
        withdrawalDraft({ amount: '500' }),
        withdrawalContext(100000)
      );

      expect(result.ok).toBe(true);
    });

    it('accepts taking out the exact balance', () => {
      const result = validateTransactionDraft(
        withdrawalDraft({ amount: '1000' }),
        withdrawalContext(100000)
      );

      expect(result.ok).toBe(true);
    });

    it('refuses more than the goal holds, and points at the amount', () => {
      const result = validateTransactionDraft(
        withdrawalDraft({ amount: '1000.01' }),
        withdrawalContext(100000)
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.amount).toContain('more than');
      // The goal itself is valid; only the figure is wrong.
      expect(result.errors.savingsGoalId).toBeUndefined();
    });

    it('never caps a contribution, however little the goal holds', () => {
      const result = validateTransactionDraft(
        withdrawalDraft({ savingDirection: 'in', amount: '100000' }),
        withdrawalContext(0)
      );

      expect(result.ok).toBe(true);
    });

    it('leaves the balance rule out when the context carries no balance', () => {
      // A caller that knows nothing about balances must not have its input
      // rejected by a rule it never supplied the numbers for.
      const result = validateTransactionDraft(withdrawalDraft({ amount: '1000000' }), {
        ...baseContext(),
        savingsGoals: [EMERGENCY],
      });

      expect(result.ok).toBe(true);
    });
  });

  it('drops savings fields from income and expense rows', () => {
    const result = validateTransactionDraft(
      draft({ savingDirection: 'in', savingsGoalId: 'goal-1' }),
      baseContext()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.savingDirection).toBeNull();
    expect(result.value.savingsGoalId).toBeNull();
  });
});

describe('validateTransactionDraft — notes length', () => {
  it('measures notes in characters and accepts a normal note', () => {
    const result = validateTransactionDraft(
      draft({ notes: 'Bought 2kg of maize flour and milk.' }),
      baseContext()
    );
    expect(result.ok).toBe(true);
  });
});

describe('refunds', () => {
  const original = transaction({ id: 'tx-original', amountMinorUnits: 100000 });

  it('accepts a partial refund of an expense', () => {
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: original.id, amount: '400' }),
      { ...baseContext(), refundedTransaction: original, alreadyRefundedMinorUnits: 0 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('expense');
    expect(result.value.amountMinorUnits).toBe(40000);
    expect(result.value.refundOfTransactionId).toBe(original.id);
  });

  it('refuses to refund more than the original amount', () => {
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: original.id, amount: '2000' }),
      { ...baseContext(), refundedTransaction: original, alreadyRefundedMinorUnits: 0 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBe('You can refund at most KSh 1,000.00 of this expense.');
  });

  it('counts earlier refunds, so the total can never exceed the original', () => {
    // KSh 600 of the KSh 1,000 expense has already been refunded.
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: original.id, amount: '500' }),
      { ...baseContext(), refundedTransaction: original, alreadyRefundedMinorUnits: 60000 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBe('You can refund at most KSh 400.00 of this expense.');
  });

  it('refuses a further refund once the expense is refunded in full', () => {
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: original.id, amount: '100' }),
      { ...baseContext(), refundedTransaction: original, alreadyRefundedMinorUnits: 100000 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBe('This expense has already been refunded in full.');
  });

  it('refuses to refund income or savings', () => {
    const income = transaction({ id: 'tx-income', type: 'income', needWant: null, categoryId: SALARY.id });
    const result = validateTransactionDraft(
      draft({ type: 'income', categoryId: SALARY.id, needWant: null, refundOfTransactionId: income.id }),
      { ...baseContext(), refundedTransaction: income }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.refundOfTransactionId).toBe('Only an expense can be refunded.');
  });

  it('refuses to refund a refund', () => {
    const alreadyARefund = transaction({ id: 'tx-refund', refundOfTransactionId: 'tx-original' });
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: alreadyARefund.id, amount: '100' }),
      { ...baseContext(), refundedTransaction: alreadyARefund }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.refundOfTransactionId).toBe('A refund cannot itself be refunded.');
  });

  it('reports a missing original expense', () => {
    const result = validateTransactionDraft(
      draft({ refundOfTransactionId: 'tx-gone', amount: '100' }),
      { ...baseContext(), refundedTransaction: null }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.refundOfTransactionId).toBe('The original expense could not be found.');
  });
});
