/**
 * Export and backup rules.
 *
 * Everything in this file is a pure function of its arguments: turning
 * transactions into CSV, building a backup file, and reading one back involve no
 * database, no file system and no React. That keeps the fiddly parts — quoting a
 * description that contains a comma or a quote, and refusing a file that is not
 * a PesaTrack backup — somewhere they can be tested directly.
 *
 * What this module deliberately does *not* do is decide where a file goes or
 * how it is shared. That is the screen's job.
 */

import { BACKUP_TABLES, DATABASE_VERSION, type BackupTables } from '@/db/schema';
import type { Transaction } from '@/types/models';
import { minorUnitsToDecimalString } from '@/utils/money';

/**
 * A marker written into every backup so an unrelated JSON file is refused
 * before any of it is trusted.
 */
export const BACKUP_APP_NAME = 'PesaTrack';

/**
 * The layout version of the backup *file*, which is separate from the database
 * schema version. It changes only if the shape of the file changes (for example
 * a new top-level field), not when a table merely gains a column.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** A backup file: everything needed to put the database back as it was. */
export type BackupFile = {
  app: string;
  format: number;
  /** The database schema version the backup was taken from. */
  schemaVersion: number;
  /** ISO timestamp of when the backup was made. */
  exportedAt: string;
  /** Row count per table, so the file can be sanity-checked by eye. */
  counts: Record<string, number>;
  tables: BackupTables;
};

/**
 * Wraps raw table rows in the backup envelope and records the row counts.
 *
 * `schemaVersion` defaults to the running app's version, which is what a real
 * export wants; tests pass it explicitly.
 */
export function buildBackupFile(
  tables: BackupTables,
  options: { exportedAt: string; schemaVersion?: number }
): BackupFile {
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    counts[table.name] = tables[table.name]?.length ?? 0;
  }

  return {
    app: BACKUP_APP_NAME,
    format: BACKUP_FORMAT_VERSION,
    schemaVersion: options.schemaVersion ?? DATABASE_VERSION,
    exportedAt: options.exportedAt,
    counts,
    tables,
  };
}

/**
 * Renders a backup as the text of the file. Indented so that a person can open
 * it in a text editor and see that it is theirs.
 */
export function serializeBackupFile(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** Either a usable backup, or one plain sentence saying why it was refused. */
export type BackupParseResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the text of a chosen file and returns it as a backup.
 *
 * Every failure produces a sentence aimed at the person holding the phone, not
 * at a developer: the file is not JSON, it is not ours, it was made by a newer
 * app, or it is missing a table. Only once all of that holds is the data handed
 * to the database layer.
 */
export function parseBackupFile(text: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not readable as a backup.' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'That file is not a PesaTrack backup.' };
  }

  if (parsed.app !== BACKUP_APP_NAME || parsed.format !== BACKUP_FORMAT_VERSION) {
    return { ok: false, error: 'That file is not a PesaTrack backup.' };
  }

  const schemaVersion = parsed.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, error: 'That backup does not say which version of PesaTrack made it.' };
  }

  if (schemaVersion > DATABASE_VERSION) {
    return {
      ok: false,
      error:
        `That backup was made by a newer version of PesaTrack (data version ${schemaVersion}). ` +
        'Update the app, then try again.',
    };
  }

  const tables = parsed.tables;
  if (!isRecord(tables)) {
    return { ok: false, error: 'That backup is missing its data.' };
  }

  for (const table of BACKUP_TABLES) {
    const rows = tables[table.name];
    if (!Array.isArray(rows)) {
      return { ok: false, error: `That backup is missing its ${table.name} data.` };
    }

    for (const row of rows) {
      if (!isRecord(row)) {
        return { ok: false, error: `That backup has a damaged row in ${table.name}.` };
      }

      for (const value of Object.values(row)) {
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
          return { ok: false, error: `That backup has an unexpected value in ${table.name}.` };
        }
      }
    }
  }

  const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '';

  // Rebuilt through `buildBackupFile` so the counts are derived from the rows
  // that were actually found, never trusted from the file.
  return {
    ok: true,
    backup: buildBackupFile(tables as BackupTables, { exportedAt, schemaVersion }),
  };
}

/** The column headings of the transactions CSV, in order. */
export const TRANSACTION_CSV_HEADERS = [
  'date',
  'type',
  'description',
  'category',
  'payment_method',
  'need_want',
  'saving_direction',
  'savings_goal',
  'amount',
  'currency',
  'is_refund',
  'notes',
] as const;

/** Names to substitute for the ids stored on a transaction. */
export type CsvLookups = {
  currencyCode: string;
  categoriesById: Readonly<Record<string, string>>;
  paymentMethodsById: Readonly<Record<string, string>>;
  savingsGoalsById: Readonly<Record<string, string>>;
};

/**
 * Quotes a field only when it needs it, following RFC 4180: a value containing a
 * comma, a quote or a line break is wrapped in quotes, and any quote inside it is
 * doubled. Descriptions and notes are free text, so this is not optional.
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function transactionCsvRow(transaction: Transaction, lookups: CsvLookups): string[] {
  return [
    transaction.date,
    transaction.type,
    transaction.description,
    lookups.categoriesById[transaction.categoryId] ?? '',
    transaction.paymentMethodId
      ? (lookups.paymentMethodsById[transaction.paymentMethodId] ?? '')
      : '',
    transaction.needWant ?? '',
    transaction.savingDirection ?? '',
    transaction.savingsGoalId ? (lookups.savingsGoalsById[transaction.savingsGoalId] ?? '') : '',
    // Amounts stay positive and the `type` column carries the direction, the
    // same invariant the database keeps.
    minorUnitsToDecimalString(transaction.amountMinorUnits),
    lookups.currencyCode,
    transaction.refundOfTransactionId ? 'yes' : 'no',
    transaction.notes ?? '',
  ];
}

/**
 * Builds the transactions CSV, oldest first.
 *
 * Ids are replaced by the names a person recognizes — a category, a payment
 * method, a savings goal — because a spreadsheet full of UUIDs is useless. Line
 * endings are CRLF, which is what spreadsheet programs expect.
 */
export function buildTransactionsCsv(
  transactions: readonly Transaction[],
  lookups: CsvLookups
): string {
  const lines = [TRANSACTION_CSV_HEADERS.join(',')];

  for (const transaction of transactions) {
    lines.push(transactionCsvRow(transaction, lookups).map(csvField).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** A dated file name that sorts chronologically and never collides by accident. */
export function backupFileName(date: string): string {
  return `pesatrack-backup-${date}.json`;
}

/** A dated file name for the transactions CSV. */
export function transactionsCsvFileName(date: string): string {
  return `pesatrack-transactions-${date}.csv`;
}
