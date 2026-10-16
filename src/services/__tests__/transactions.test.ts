/**
 * Tests the transaction service helpers that do not touch the database.
 *
 * `saveTransaction` itself is exercised on the phone; what is worth pinning down
 * in a unit test is the draft conversion, because the form relies on it to
 * re-open a stored transaction for editing and it must round-trip exactly —
 * in particular the amount, which must come back as an editable string rather
 * than a raw minor-units number.
 */

import { transactionToDraft } from '../transactions';
import type { Transaction } from '@/types/models';

const BASE: Transaction = {
  id: 'tx-1',
  type: 'expense',
  amountMinorUnits: 125050,
  date: '2026-10-15',
  description: 'Lunch',
  notes: null,
  categoryId: 'cat-food',
  needWant: 'want',
  paymentMethodId: 'pm-mpesa',
  savingDirection: null,
  savingsGoalId: null,
  refundOfTransactionId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

describe('transactionToDraft', () => {
  it('converts a whole amount to a string without a trailing .00', () => {
    const draft = transactionToDraft({ ...BASE, amountMinorUnits: 125000 });

    expect(draft.amount).toBe('1250');
  });

  it('keeps the cents when the amount has them', () => {
    const draft = transactionToDraft({ ...BASE, amountMinorUnits: 125050 });

    expect(draft.amount).toBe('1250.50');
  });

  it('copies every editable field across', () => {
    const draft = transactionToDraft(BASE);

    expect(draft).toEqual({
      type: 'expense',
      amount: '1250.50',
      date: '2026-10-15',
      description: 'Lunch',
      notes: null,
      categoryId: 'cat-food',
      needWant: 'want',
      paymentMethodId: 'pm-mpesa',
      savingDirection: null,
      savingsGoalId: null,
      refundOfTransactionId: null,
    });
  });

  it('carries the saving direction through for a saving transaction', () => {
    const draft = transactionToDraft({
      ...BASE,
      type: 'saving',
      amountMinorUnits: 500000,
      needWant: null,
      savingDirection: 'in',
    });

    expect(draft.type).toBe('saving');
    expect(draft.amount).toBe('5000');
    expect(draft.savingDirection).toBe('in');
    expect(draft.needWant).toBeNull();
  });

  it('preserves the refund link so an edited refund stays a refund', () => {
    const draft = transactionToDraft({ ...BASE, refundOfTransactionId: 'tx-original' });

    expect(draft.refundOfTransactionId).toBe('tx-original');
  });
});
