/**
 * Transaction service — the only path from a screen to the database.
 *
 * Screens hand over a draft (strings, ids, maybe nothing chosen yet). This
 * layer loads what the rules need, validates, and either returns field-level
 * messages for the form or stores the row and returns it. Nothing here renders.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { listCategories } from '@/db/repositories/categories';
import { listPaymentMethods } from '@/db/repositories/payment-methods';
import {
  deleteTransaction,
  getTransactionById,
  insertTransaction,
  listRefundsOf,
  updateTransaction,
} from '@/db/repositories/transactions';
import type { Transaction } from '@/types/models';
import { todayIso } from '@/utils/dates';

import {
  validateTransactionDraft,
  type TransactionDraft,
  type TransactionValidationContext,
  type ValidationResult,
} from './validation';

/**
 * Loads the look-ups the rules need.
 *
 * Categories and payment methods are fetched *including* retired ones, because
 * an old transaction may legitimately still use one; the validation context
 * decides whether that is allowed.
 */
export async function buildValidationContext(
  db: SQLiteDatabase,
  draft: TransactionDraft,
  currentTransaction?: Transaction | null
): Promise<TransactionValidationContext> {
  const [categories, paymentMethods] = await Promise.all([
    listCategories(db, { includeInactive: true }),
    listPaymentMethods(db, { includeInactive: true }),
  ]);

  const context: TransactionValidationContext = {
    categories,
    paymentMethods,
    currentCategoryId: currentTransaction?.categoryId ?? null,
    currentPaymentMethodId: currentTransaction?.paymentMethodId ?? null,
  };

  if (draft.refundOfTransactionId) {
    context.refundedTransaction = await getTransactionById(db, draft.refundOfTransactionId);

    let alreadyRefunded = await getRefundedAmountMinorUnits(
      db,
      draft.refundOfTransactionId
    );

    // When editing a refund itself, its current amount is not "already
    // refunded" — it is the value being replaced. Counting it would make it
    // impossible to correct the refund upwards.
    if (currentTransaction?.refundOfTransactionId === draft.refundOfTransactionId) {
      alreadyRefunded -= currentTransaction.amountMinorUnits;
    }

    context.alreadyRefundedMinorUnits = Math.max(0, alreadyRefunded);
  }
  return context;
}

/**
 * Validates and stores a draft.
 *
 * On success the saved row comes back, so the caller can show it or navigate
 * away knowing the write succeeded. On failure nothing is written at all.
 */
export async function saveTransaction(
  db: SQLiteDatabase,
  draft: TransactionDraft,
  options: { id?: string } = {}
): Promise<ValidationResult<Transaction>> {
  const current = options.id ? await getTransactionById(db, options.id) : null;

  if (options.id && !current) {
    return { ok: false, errors: { description: 'That transaction no longer exists.' } };
  }

  const context = await buildValidationContext(db, draft, current);
  const validation = validateTransactionDraft(draft, context);

  if (!validation.ok) {
    return validation;
  }

  const saved = current
    ? await updateTransaction(db, current.id, {
        ...validation.value,
        // A refund keeps pointing at the same original expense: the field is
        // not editable once the row exists.
        refundOfTransactionId: current.refundOfTransactionId,
      })
    : await insertTransaction(db, validation.value);

  return { ok: true, value: saved };
}

/**
 * How much has already been refunded against an expense: the sum of every
 * refund recorded against it.
 */
export async function getRefundedAmountMinorUnits(
  db: SQLiteDatabase,
  originalTransactionId: string
): Promise<number> {
  const refunds = await listRefundsOf(db, originalTransactionId);
  return refunds.reduce((total, refund) => total + refund.amountMinorUnits, 0);
}

/**
 * How much of an expense is still refundable: the original amount minus the
 * refunds already recorded against it.
 */
export async function getRefundableAmountMinorUnits(
  db: SQLiteDatabase,
  originalTransactionId: string
): Promise<number> {
  const original = await getTransactionById(db, originalTransactionId);
  if (!original) {
    return 0;
  }

  const alreadyRefunded = await getRefundedAmountMinorUnits(db, originalTransactionId);

  // Never negative, even if data from an older version were inconsistent.
  return Math.max(0, original.amountMinorUnits - alreadyRefunded);
}

/**
 * Records a refund against an existing expense.
 *
 * The refund is stored as its own expense row that points at the original, so
 * the original stays as it was recorded and the pair nets to zero in every
 * spending total. Nothing is ever recorded as income here — a refund is the
 * undoing of a cost, not money earned.
 */
export async function recordRefund(
  db: SQLiteDatabase,
  originalTransactionId: string,
  input: { amount: string; date?: string; description?: string; notes?: string | null }
): Promise<ValidationResult<Transaction>> {
  const original = await getTransactionById(db, originalTransactionId);

  if (!original) {
    return { ok: false, errors: { refundOfTransactionId: 'The original expense could not be found.' } };
  }

  if (original.type !== 'expense') {
    return { ok: false, errors: { refundOfTransactionId: 'Only an expense can be refunded.' } };
  }

  if (original.refundOfTransactionId) {
    return { ok: false, errors: { refundOfTransactionId: 'A refund cannot itself be refunded.' } };
  }

  const draft: TransactionDraft = {
    type: 'expense',
    amount: input.amount,
    date: input.date ?? todayIso(),
    // Default description names the original, so a long history stays readable.
    description: input.description ?? `Refund: ${original.description}`,
    notes: input.notes ?? null,
    categoryId: original.categoryId,
    needWant: original.needWant,
    paymentMethodId: original.paymentMethodId,
    savingDirection: null,
    savingsGoalId: null,
    refundOfTransactionId: originalTransactionId,
  };

  return saveTransaction(db, draft);
}

/**
 * Deletes a transaction after checking that nothing depends on it.
 *
 * Expenses that were refunded are protected: deleting the original would leave
 * a refund that reverses nothing, so the user is asked to remove the refund
 * first. This mirrors the `ON DELETE RESTRICT` constraint in the schema, but
 * explains the situation instead of failing with a driver error.
 */
export async function deleteTransactionSafely(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const refunds = await listRefundsOf(db, id);

  if (refunds.length > 0) {
    throw new Error(
      'This expense has a refund recorded against it. Remove the refund first.'
    );
  }

  await deleteTransaction(db, id);
}
