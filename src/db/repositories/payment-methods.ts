import type { SQLiteDatabase } from 'expo-sqlite';

import type { PaymentMethod } from '@/types/models';
import { createId, nowIso } from '@/utils/ids';

import { DuplicateNameError, isUniqueConstraintViolation } from '../errors';

/**
 * Reads and writes payment methods.
 *
 * A payment method is a label: "M-Pesa", "Cash", "Bank". PesaTrack does not
 * connect to M-Pesa, a bank or a card, and never stores an account number, PIN
 * or balance. The label exists so the user can see *how* money moved when
 * reading their history — nothing more.
 *
 * Like categories, payment methods are retired rather than deleted, so old
 * transactions keep their label.
 */

type PaymentMethodRow = {
  id: string;
  name: string;
  is_default: number;
  is_active: number;
  sort_order: number;
  created_at: string;
};

const PAYMENT_METHOD_COLUMNS = 'id, name, is_default, is_active, sort_order, created_at';

function rowToPaymentMethod(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export type ListPaymentMethodsOptions = {
  /** Include retired methods (needed by the settings screen). */
  includeInactive?: boolean;
};

/** Lists payment methods in display order. Active-only by default. */
export async function listPaymentMethods(
  db: SQLiteDatabase,
  options: ListPaymentMethodsOptions = {}
): Promise<PaymentMethod[]> {
  const whereClause = options.includeInactive ? '' : 'WHERE is_active = 1';

  const rows = await db.getAllAsync<PaymentMethodRow>(
    `SELECT ${PAYMENT_METHOD_COLUMNS}
     FROM payment_methods
     ${whereClause}
     ORDER BY sort_order, name COLLATE NOCASE;`
  );

  return rows.map(rowToPaymentMethod);
}

/** Returns one payment method, or `null` when the id is unknown. */
export async function getPaymentMethodById(
  db: SQLiteDatabase,
  id: string
): Promise<PaymentMethod | null> {
  const row = await db.getFirstAsync<PaymentMethodRow>(
    `SELECT ${PAYMENT_METHOD_COLUMNS} FROM payment_methods WHERE id = ?;`,
    [id]
  );
  return row ? rowToPaymentMethod(row) : null;
}

/**
 * The method to pre-select on a new transaction: the user's chosen default when
 * it is still active, otherwise the first active method, otherwise `null` when
 * every method has been retired.
 */
export async function getPreferredPaymentMethod(
  db: SQLiteDatabase
): Promise<PaymentMethod | null> {
  const row = await db.getFirstAsync<PaymentMethodRow>(
    `SELECT ${PAYMENT_METHOD_COLUMNS}
     FROM payment_methods
     WHERE is_active = 1
     ORDER BY is_default DESC, sort_order, name COLLATE NOCASE
     LIMIT 1;`
  );
  return row ? rowToPaymentMethod(row) : null;
}

/**
 * Creates a payment method.
 * Throws `DuplicateNameError` if the name is already taken (ignoring case and
 * surrounding spaces).
 */
export async function createPaymentMethod(
  db: SQLiteDatabase,
  name: string
): Promise<PaymentMethod> {
  const id = createId();
  const trimmed = name.trim();

  const nextSortOrder = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(sort_order) + 1 AS next FROM payment_methods;'
  );

  try {
    await db.runAsync(
      `INSERT INTO payment_methods (id, name, is_default, is_active, sort_order, created_at)
       VALUES (?, ?, 0, 1, ?, ?);`,
      [id, trimmed, nextSortOrder?.next ?? 0, nowIso()]
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateNameError(`A payment method named "${trimmed}"`);
    }
    throw error;
  }

  const created = await getPaymentMethodById(db, id);
  if (!created) {
    throw new Error('The payment method could not be created.');
  }
  return created;
}

/** Renames a payment method. */
export async function renamePaymentMethod(
  db: SQLiteDatabase,
  id: string,
  name: string
): Promise<PaymentMethod> {
  const trimmed = name.trim();

  try {
    await db.runAsync('UPDATE payment_methods SET name = ? WHERE id = ?;', [trimmed, id]);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateNameError(`A payment method named "${trimmed}"`);
    }
    throw error;
  }

  const updated = await getPaymentMethodById(db, id);
  if (!updated) {
    throw new Error('That payment method no longer exists.');
  }
  return updated;
}

/**
 * Activates or retires a payment method.
 * The last active method cannot be retired, so the transaction form always has
 * something to show.
 */
export async function setPaymentMethodActive(
  db: SQLiteDatabase,
  id: string,
  isActive: boolean
): Promise<PaymentMethod> {
  const existing = await getPaymentMethodById(db, id);
  if (!existing) {
    throw new Error('That payment method no longer exists.');
  }

  if (!isActive) {
    const activeCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM payment_methods WHERE is_active = 1;'
    );

    if ((activeCount?.count ?? 0) <= 1) {
      throw new Error(
        `"${existing.name}" is the only active payment method. ` +
          'Create another one before retiring this.'
      );
    }
  }

  await db.runAsync('UPDATE payment_methods SET is_active = ? WHERE id = ?;', [isActive ? 1 : 0, id]);

  const updated = await getPaymentMethodById(db, id);
  if (!updated) {
    throw new Error('That payment method could not be updated.');
  }
  return updated;
}

/**
 * Marks one method as the default and clears the flag everywhere else, so the
 * database can never hold two defaults and the form's pre-selection is
 * unambiguous. Both statements run in a transaction: a half-applied switch is
 * impossible.
 */
export async function setDefaultPaymentMethod(
  db: SQLiteDatabase,
  id: string
): Promise<PaymentMethod> {
  const existing = await getPaymentMethodById(db, id);
  if (!existing) {
    throw new Error('That payment method no longer exists.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE payment_methods SET is_default = 0 WHERE is_default = 1;');
    await db.runAsync('UPDATE payment_methods SET is_default = 1, is_active = 1 WHERE id = ?;', [id]);
  });

  const updated = await getPaymentMethodById(db, id);
  if (!updated) {
    throw new Error('That payment method could not be updated.');
  }
  return updated;
}
