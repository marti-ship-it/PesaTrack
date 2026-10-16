/**
 * Transaction validation rules.
 *
 * This module is deliberately pure: it takes the user's draft plus whatever
 * look-ups it needs (categories, payment methods, an original expense) and
 * returns either a ready-to-store value or field-level messages. No database,
 * no React, no side effects — which is exactly what makes the awkward cases
 * ("a refund larger than the original", "an expense category chosen for
 * income") testable without a phone or a database.
 *
 * The rules are enforced twice on purpose:
 *   - here, to produce a message a person can act on;
 *   - by CHECK constraints in the schema, so bad data cannot be stored even if
 *     a future screen forgets to call this.
 */

import type {
  Category,
  NeedWant,
  PaymentMethod,
  SavingDirection,
  SavingsGoal,
  Transaction,
  TransactionType,
} from '@/types/models';
import { isValidIsoDate } from '@/utils/dates';
import { formatMinorUnits, parseAmountToMinorUnits } from '@/utils/money';

/** Longest allowed values, kept in step with the schema's CHECK constraints. */
export const MAX_DESCRIPTION_LENGTH = 120;
export const MAX_NOTES_LENGTH = 500;

/**
 * What a form produces, before validation. Amounts are still strings because
 * that is what a text input holds; `null` means "nothing chosen yet".
 */
export type TransactionDraft = {
  type: TransactionType | null;
  amount: string;
  date: string;
  description: string;
  notes: string | null;
  categoryId: string | null;
  needWant: NeedWant | null;
  paymentMethodId: string | null;
  savingDirection: SavingDirection | null;
  savingsGoalId: string | null;
  /** Set when this draft records a refund of an earlier expense. */
  refundOfTransactionId: string | null;
};

/** A blank draft, with sensible starting values for a new transaction. */
export function createEmptyDraft(date: string): TransactionDraft {
  return {
    type: null,
    amount: '',
    date,
    description: '',
    notes: null,
    categoryId: null,
    needWant: null,
    paymentMethodId: null,
    savingDirection: null,
    savingsGoalId: null,
    refundOfTransactionId: null,
  };
}

/** One message per field, so a form can show it under the right input. */
export type FieldErrors = Partial<Record<keyof TransactionDraft, string>>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** The validated, storage-ready shape (mirrors `TransactionWrite`). */
export type ValidatedTransaction = {
  type: TransactionType;
  amountMinorUnits: number;
  date: string;
  description: string;
  notes: string | null;
  categoryId: string;
  needWant: NeedWant | null;
  paymentMethodId: string | null;
  savingDirection: SavingDirection | null;
  savingsGoalId: string | null;
  refundOfTransactionId: string | null;
};

export type TransactionValidationContext = {
  /** The user's active categories; inactive ones are listed separately below. */
  categories: readonly Category[];
  paymentMethods: readonly PaymentMethod[];
  /** Savings goals, when the savings feature is in use. */
  savingsGoals?: readonly SavingsGoal[];
  /**
   * Categories and payment methods already used by the transaction being
   * edited. They are allowed even if since retired — otherwise an old
   * transaction could not be corrected without rewriting its history.
   */
  currentCategoryId?: string | null;
  currentPaymentMethodId?: string | null;
  /** The expense being refunded, when `refundOfTransactionId` is set. */
  refundedTransaction?: Transaction | null;
  /** How much of that expense has already been refunded. */
  alreadyRefundedMinorUnits?: number;
};

const NEED_WANT_VALUES: readonly NeedWant[] = ['need', 'want', 'unexpected'];

/** Validates a draft and converts it into a storage-ready value. */
export function validateTransactionDraft(
  draft: TransactionDraft,
  context: TransactionValidationContext
): ValidationResult<ValidatedTransaction> {
  const errors: FieldErrors = {};

  // --- Type -----------------------------------------------------------------
  if (draft.type === null) {
    errors.type = 'Choose Income, Expense or Savings.';
  }

  // --- Amount ---------------------------------------------------------------
  const amountMinorUnits = parseAmountToMinorUnits(draft.amount);
  if (amountMinorUnits === null) {
    errors.amount = 'Enter a valid amount, for example 1250.50.';
  } else if (amountMinorUnits === 0) {
    errors.amount = 'The amount must be more than zero.';
  }

  // --- Date -----------------------------------------------------------------
  if (!isValidIsoDate(draft.date)) {
    errors.date = 'Choose a valid date.';
  }

  // --- Description and notes ------------------------------------------------
  const description = draft.description.trim();
  if (description.length === 0) {
    errors.description = 'Add a short description.';
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  const notes = draft.notes?.trim() ? draft.notes.trim() : null;
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Keep notes under ${MAX_NOTES_LENGTH} characters.`;
  }

  // --- Category must exist *and* match the type -----------------------------
  // This is the enforced version of "the category list depends on the type":
  // the schema stores categories with a type, and this check refuses a mismatch
  // even if a screen were to offer the wrong list.
  const category = draft.categoryId
    ? (context.categories.find((item) => item.id === draft.categoryId) ?? null)
    : null;

  if (!draft.categoryId) {
    errors.categoryId = 'Choose a category.';
  } else if (!category) {
    errors.categoryId = 'That category is no longer available.';
  } else if (draft.type !== null && category.type !== draft.type) {
    errors.categoryId = `"${category.name}" belongs to ${category.type} categories, so it cannot be used for ${draft.type}.`;
  } else if (!category.isActive && category.id !== context.currentCategoryId) {
    errors.categoryId = `"${category.name}" has been retired. Choose another category.`;
  }

  // --- Need / Want / Unexpected --------------------------------------------
  // Required for expenses (it drives the Need vs Want report), and refused for
  // income and savings, which have no such thing.
  if (draft.type === 'expense') {
    if (draft.needWant === null) {
      errors.needWant = 'Choose Need, Want or Unexpected.';
    } else if (!NEED_WANT_VALUES.includes(draft.needWant)) {
      errors.needWant = 'Choose Need, Want or Unexpected.';
    }
  }

  // --- Payment method (optional) -------------------------------------------
  const paymentMethod = draft.paymentMethodId
    ? (context.paymentMethods.find((item) => item.id === draft.paymentMethodId) ?? null)
    : null;

  if (draft.paymentMethodId && !paymentMethod) {
    errors.paymentMethodId = 'That payment method is no longer available.';
  } else if (
    paymentMethod &&
    !paymentMethod.isActive &&
    paymentMethod.id !== context.currentPaymentMethodId
  ) {
    errors.paymentMethodId = `"${paymentMethod.name}" has been retired. Choose another payment method.`;
  }

  // --- Savings --------------------------------------------------------------
  if (draft.type === 'saving') {
    if (draft.savingDirection === null) {
      errors.savingDirection = 'Choose whether money went into or out of savings.';
    }

    // A goal link is optional, but a link to a goal that no longer exists is a
    // mistake worth reporting rather than letting the foreign key complain.
    if (draft.savingsGoalId && context.savingsGoals) {
      const goalExists = context.savingsGoals.some((goal) => goal.id === draft.savingsGoalId);
      if (!goalExists) {
        errors.savingsGoalId = 'That savings goal is no longer available.';
      }
    }
  }

  // --- Refunds --------------------------------------------------------------
  // A refund is the reversal of an expense. It is stored as its own expense row
  // pointing at the original, so the original stays untouched as history.
  if (draft.refundOfTransactionId) {
    const original = context.refundedTransaction ?? null;
    const alreadyRefunded = context.alreadyRefundedMinorUnits ?? 0;

    if (draft.type !== null && draft.type !== 'expense') {
      errors.refundOfTransactionId = 'Only an expense can be refunded.';
    } else if (!original) {
      errors.refundOfTransactionId = 'The original expense could not be found.';
    } else if (original.refundOfTransactionId) {
      errors.refundOfTransactionId = 'A refund cannot itself be refunded.';
    } else if (amountMinorUnits !== null && amountMinorUnits > 0) {
      const refundable = original.amountMinorUnits - alreadyRefunded;
      if (refundable <= 0) {
        errors.amount = 'This expense has already been refunded in full.';
      } else if (amountMinorUnits > refundable) {
        errors.amount = `You can refund at most ${formatMinorUnits(refundable)} of this expense.`;
      }
    }
  }

  if (Object.keys(errors).length > 0 || draft.type === null || amountMinorUnits === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      type: draft.type,
      amountMinorUnits,
      date: draft.date,
      description,
      notes,
      categoryId: draft.categoryId as string,
      // Need/Want exists on expenses only, whatever the form sent.
      needWant: draft.type === 'expense' ? draft.needWant : null,
      paymentMethodId: draft.paymentMethodId,
      // Savings fields are meaningful for saving transactions only.
      savingDirection: draft.type === 'saving' ? draft.savingDirection : null,
      savingsGoalId: draft.type === 'saving' ? draft.savingsGoalId : null,
      refundOfTransactionId: draft.refundOfTransactionId,
    },
  };
}
