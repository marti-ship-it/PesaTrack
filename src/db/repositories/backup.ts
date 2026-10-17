import type { SQLiteDatabase } from 'expo-sqlite';

import { BACKUP_TABLES, type BackupTables, type BackupValue } from '@/db/schema';
import type { Transaction } from '@/types/models';

import { listCategories } from './categories';
import { listPaymentMethods } from './payment-methods';
import { listSavingsGoals } from './savings-goals';
import { getSettings } from './settings';
import { listTransactions } from './transactions';

/**
 * Reads and writes the whole database for export and restore.
 *
 * A backup is *logical* — rows, not the SQLite file. That is deliberate: the
 * database file is written ahead of time and locked open while the app runs, so
 * copying it out is fragile, whereas rows survive the trip between schema
 * versions and can be checked before they are trusted.
 *
 * The reading side is generic, driven by `BACKUP_TABLES`, so adding a table to
 * the backup is a one-line change in the schema rather than a new query here.
 */

/** Reads every row of every table a backup contains. */
export async function readAllTables(db: SQLiteDatabase): Promise<BackupTables> {
  const tables: BackupTables = {};

  for (const table of BACKUP_TABLES) {
    const rows = await db.getAllAsync<Record<string, BackupValue>>(
      `SELECT ${table.columns.join(', ')} FROM ${table.name};`
    );
    tables[table.name] = rows;
  }

  return tables;
}

function bindable(value: BackupValue | undefined): BackupValue {
  return value === undefined ? null : value;
}

/**
 * Replaces the whole database with a backup, inside one transaction.
 *
 * Two details make this safe:
 *
 *   1. It is all-or-nothing. Either every table is emptied and repopulated, or —
 *      if any row is rejected by a constraint — the transaction rolls back and
 *      the device is left exactly as it was. There is no half-restored state.
 *   2. Foreign keys are deferred to the end of the transaction. That lets a
 *      refund row be inserted without depending on whether the expense it
 *      reverses happens to come first in the file, and it still refuses a backup
 *      that refers to a category that does not exist.
 */
export async function replaceAllTables(db: SQLiteDatabase, tables: BackupTables): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');

    // Children first, so nothing is deleted while it is still referenced.
    for (const table of [...BACKUP_TABLES].reverse()) {
      await db.execAsync(`DELETE FROM ${table.name};`);
    }

    // Parents first, which reads naturally and keeps the intent obvious.
    for (const table of BACKUP_TABLES) {
      const rows = tables[table.name] ?? [];
      if (rows.length === 0) {
        continue;
      }

      const placeholders = table.columns.map(() => '?').join(', ');
      const insertSql =
        `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders});`;

      for (const row of rows) {
        await db.runAsync(insertSql, table.columns.map((column) => bindable(row[column])));
      }
    }
  });
}

/** The data the transactions CSV needs, already resolved to display names. */
export type CsvExportData = {
  transactions: Transaction[];
  categoriesById: Record<string, string>;
  paymentMethodsById: Record<string, string>;
  savingsGoalsById: Record<string, string>;
  currencyCode: string;
};

/**
 * Loads everything the CSV writer needs in one go.
 *
 * Retired categories and payment methods are included on purpose: an old
 * transaction may point at one, and its name is exactly what makes the exported
 * row readable. The same reasoning includes archived goals.
 */
export async function readCsvExportData(db: SQLiteDatabase): Promise<CsvExportData> {
  const [transactions, categories, paymentMethods, savingsGoals, settings] = await Promise.all([
    listTransactions(db, { order: 'oldest' }),
    listCategories(db, { includeInactive: true }),
    listPaymentMethods(db, { includeInactive: true }),
    listSavingsGoals(db, { includeArchived: true }),
    getSettings(db),
  ]);

  return {
    transactions,
    categoriesById: Object.fromEntries(categories.map((category) => [category.id, category.name])),
    paymentMethodsById: Object.fromEntries(
      paymentMethods.map((method) => [method.id, method.name])
    ),
    savingsGoalsById: Object.fromEntries(savingsGoals.map((goal) => [goal.id, goal.name])),
    currencyCode: settings.currencyCode,
  };
}
