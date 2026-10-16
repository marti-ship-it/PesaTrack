import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  NeedWant,
  SavingDirection,
  Transaction,
  TransactionType,
} from '@/types/models';
import type { IsoDate } from '@/utils/dates';
import { createId, nowIso } from '@/utils/ids';

import { NET_AMOUNT_EXPRESSION } from '../schema';

/**
 * Reads and writes transactions — the single source of truth for money.
 *
 * Two rules live here rather than in the screens:
 *
 *   1. **Amounts are always stored positive.** A refund is an `expense` row
 *      pointing at the expense it reverses (`refundOfTransactionId`), and the
 *      sign is applied only when totalling, via `NET_AMOUNT_EXPRESSION` in
 *      schema.ts. So a plain `SUM(amount_minor_units)` is *not* a spending
 *      total — it is a gross total. Use the expression.
 *
 *   2. **The type decides which fields are meaningful.** Income and expenses
 *      have no savings direction; only expenses have a Need/Want. The schema
 *      rejects mismatches, and the service layer produces a readable message
 *      before we ever reach the database.
 */

type TransactionRow = {
  id: string;
  type: string;
  amount_minor_units: number;
  date: string;
  description: string;
  notes: string | null;
  category_id: string;
  need_want: string | null;
  payment_method_id: string | null;
  saving_direction: string | null;
  savings_goal_id: string | null;
  refund_of_transaction_id: string | null;
  created_at: string;
  updated_at: string;
};

const TRANSACTION_COLUMNS = `
  id, type, amount_minor_units, date, description, notes, category_id, need_want,
  payment_method_id, saving_direction, savings_goal_id, refund_of_transaction_id,
  created_at, updated_at
`;

function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    // Casts are safe: the column CHECK constraints allow only these values.
    type: row.type as TransactionType,
    amountMinorUnits: row.amount_minor_units,
    date: row.date,
    description: row.description,
    notes: row.notes,
    categoryId: row.category_id,
    needWant: row.need_want as NeedWant | null,
    paymentMethodId: row.payment_method_id,
    savingDirection: row.saving_direction as SavingDirection | null,
    savingsGoalId: row.savings_goal_id,
    refundOfTransactionId: row.refund_of_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Everything needed to store a transaction, already validated and already in
 * minor units. Screens produce this through `saveTransaction` in the service
 * layer, never by hand.
 */
export type TransactionWrite = {
  type: TransactionType;
  /** Positive integer, in minor units. */
  amountMinorUnits: number;
  date: IsoDate;
  description: string;
  notes: string | null;
  categoryId: string;
  needWant: NeedWant | null;
  paymentMethodId: string | null;
  savingDirection: SavingDirection | null;
  savingsGoalId: string | null;
  /** Set when this row reverses an earlier expense. */
  refundOfTransactionId: string | null;
};

/** Inserts a transaction and returns the stored row. */
export async function insertTransaction(
  db: SQLiteDatabase,
  input: TransactionWrite
): Promise<Transaction> {
  const id = createId();
  const timestamp = nowIso();

  await db.runAsync(
    `INSERT INTO transactions (
       id, type, amount_minor_units, date, description, notes, category_id, need_want,
       payment_method_id, saving_direction, savings_goal_id, refund_of_transaction_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.type,
      input.amountMinorUnits,
      input.date,
      input.description.trim(),
      input.notes?.trim() ? input.notes.trim() : null,
      input.categoryId,
      input.needWant,
      input.paymentMethodId,
      input.savingDirection,
      input.savingsGoalId,
      input.refundOfTransactionId,
      timestamp,
      timestamp,
    ]
  );

  const created = await getTransactionById(db, id);
  if (!created) {
    throw new Error('The transaction could not be saved.');
  }
  return created;
}

/** Replaces an existing transaction in place, keeping its `createdAt`. */
export async function updateTransaction(
  db: SQLiteDatabase,
  id: string,
  input: TransactionWrite
): Promise<Transaction> {
  await db.runAsync(
    `UPDATE transactions SET
       type = ?,
       amount_minor_units = ?,
       date = ?,
       description = ?,
       notes = ?,
       category_id = ?,
       need_want = ?,
       payment_method_id = ?,
       saving_direction = ?,
       savings_goal_id = ?,
       updated_at = ?
     WHERE id = ?;`,
    [
      input.type,
      input.amountMinorUnits,
      input.date,
      input.description.trim(),
      input.notes?.trim() ? input.notes.trim() : null,
      input.categoryId,
      input.needWant,
      input.paymentMethodId,
      input.savingDirection,
      input.savingsGoalId,
      nowIso(),
      id,
    ]
  );

  const updated = await getTransactionById(db, id);
  if (!updated) {
    throw new Error('That transaction no longer exists.');
  }
  return updated;
}

/**
 * Deletes a transaction permanently.
 *
 * Refused when the row has been refunded, because `refund_of_transaction_id`
 * uses `ON DELETE RESTRICT`: deleting the expense would leave a refund that
 * reverses nothing. The service layer explains this to the user instead of
 * letting them discover it as a database error.
 */
export async function deleteTransaction(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM transactions WHERE id = ?;', [id]);
}

/** Returns one transaction, or `null` when the id is unknown. */
export async function getTransactionById(
  db: SQLiteDatabase,
  id: string
): Promise<Transaction | null> {
  const row = await db.getFirstAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE id = ?;`,
    [id]
  );
  return row ? rowToTransaction(row) : null;
}

/** Returns the transactions that reverse the given expense. */
export async function listRefundsOf(
  db: SQLiteDatabase,
  originalTransactionId: string
): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS}
     FROM transactions
     WHERE refund_of_transaction_id = ?
     ORDER BY date DESC, created_at DESC;`,
    [originalTransactionId]
  );
  return rows.map(rowToTransaction);
}

export type TransactionFilter = {
  type?: TransactionType;
  categoryId?: string;
  paymentMethodId?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from?: IsoDate;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  to?: IsoDate;
  /** Free text matched against description *and* notes. */
  search?: string;
  order?: 'newest' | 'oldest';
  limit?: number;
  offset?: number;
};

/**
 * Escapes the wildcards SQL's `LIKE` understands, so searching for "50% off"
 * looks for that text instead of matching everything.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Lists transactions newest first (or oldest first) with optional filters.
 *
 * Sorting by `date DESC, created_at DESC` means several purchases on the same
 * day still appear in the order they were entered.
 */
export async function listTransactions(
  db: SQLiteDatabase,
  filter: TransactionFilter = {}
): Promise<Transaction[]> {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];

  if (filter.type) {
    conditions.push('type = ?');
    parameters.push(filter.type);
  }

  if (filter.categoryId) {
    conditions.push('category_id = ?');
    parameters.push(filter.categoryId);
  }

  if (filter.paymentMethodId) {
    conditions.push('payment_method_id = ?');
    parameters.push(filter.paymentMethodId);
  }

  // Inclusive on both ends: a transaction dated exactly `to` belongs to the range.
  if (filter.from) {
    conditions.push('date >= ?');
    parameters.push(filter.from);
  }

  if (filter.to) {
    conditions.push('date <= ?');
    parameters.push(filter.to);
  }

  const search = filter.search?.trim();
  if (search) {
    conditions.push(
      "(description LIKE ? ESCAPE '\\' OR IFNULL(notes, '') LIKE ? ESCAPE '\\')"
    );
    const pattern = `%${escapeLikePattern(search)}%`;
    parameters.push(pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const direction = filter.order === 'oldest' ? 'ASC' : 'DESC';

  // LIMIT -1 means "no limit" in SQLite, which keeps the SQL valid whether or
  // not a paging window was requested.
  parameters.push(filter.limit ?? -1, filter.offset ?? 0);

  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS}
     FROM transactions
     ${whereClause}
     ORDER BY date ${direction}, created_at ${direction}
     LIMIT ? OFFSET ?;`,
    parameters
  );

  return rows.map(rowToTransaction);
}

/** How many transactions match a filter. Used for paging and for tests. */
export async function countTransactions(
  db: SQLiteDatabase,
  filter: Pick<TransactionFilter, 'type' | 'from' | 'to'> = {}
): Promise<number> {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];

  if (filter.type) {
    conditions.push('type = ?');
    parameters.push(filter.type);
  }
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

/** Aggregate sums over transactions, always in integer minor units. */
export type TransactionTotals = {
  incomeMinorUnits: number;
  /** Expenses net of refunds, via `NET_AMOUNT_EXPRESSION`. */
  expensesNetMinorUnits: number;
  savingsInMinorUnits: number;
  savingsOutMinorUnits: number;
};

/**
 * Sums income, net expenses and savings movements in a single pass.
 *
 * - **Income**: a plain sum — income rows can never be refunds (schema CHECK),
 *   so no netting applies.
 * - **Expenses**: `NET_AMOUNT_EXPRESSION`, so a refund subtracts on the date it
 *   is recorded. This is the only correct expense total; `SUM(amount)` would be
 *   a gross figure that ignores refunds entirely.
 * - **Savings**: split by direction and kept out of income and expenses, because
 *   a saving row *moves* money between pots rather than spending it.
 *
 * With no filter this summarises all time; `from`/`to` are inclusive on both
 * ends. An empty range comes back as zeros, never `NULL`.
 */
export async function summarizeTransactions(
  db: SQLiteDatabase,
  filter: Pick<TransactionFilter, 'from' | 'to'> = {}
): Promise<TransactionTotals> {
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

  const row = await db.getFirstAsync<{
    income_minor_units: number;
    expenses_net_minor_units: number;
    savings_in_minor_units: number;
    savings_out_minor_units: number;
  }>(
    `SELECT
       IFNULL(SUM(CASE WHEN type = 'income' THEN amount_minor_units END), 0) AS income_minor_units,
       IFNULL(SUM(CASE WHEN type = 'expense' THEN ${NET_AMOUNT_EXPRESSION} END), 0) AS expenses_net_minor_units,
       IFNULL(SUM(CASE WHEN type = 'saving' AND saving_direction = 'in' THEN amount_minor_units END), 0) AS savings_in_minor_units,
       IFNULL(SUM(CASE WHEN type = 'saving' AND saving_direction = 'out' THEN amount_minor_units END), 0) AS savings_out_minor_units
     FROM transactions
     ${whereClause};`,
    parameters
  );

  return {
    incomeMinorUnits: row?.income_minor_units ?? 0,
    expensesNetMinorUnits: row?.expenses_net_minor_units ?? 0,
    savingsInMinorUnits: row?.savings_in_minor_units ?? 0,
    savingsOutMinorUnits: row?.savings_out_minor_units ?? 0,
  };
}
