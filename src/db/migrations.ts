/**
 * Database creation and upgrades.
 *
 * The rule that keeps user data safe: **the schema is only ever changed
 * forward.** Each change gets its own numbered step below, and SQLite remembers
 * which steps already ran in its built-in `user_version` counter. A phone that
 * already has version 1 simply skips it, so opening the app after an update
 * never wipes or recreates data.
 *
 * When you change the schema:
 *   1. add a new `Migration` with the next number — do not edit an old one,
 *   2. bump `DATABASE_VERSION` in `schema.ts` to match.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { createId, nowIso } from '@/utils/ids';

import { insertDefaultSettingsRow } from './repositories/settings';
import {
  DATABASE_VERSION,
  DEFAULT_PAYMENT_METHOD_NAME,
  SCHEMA_V1,
  SEED_CATEGORIES,
  SEED_PAYMENT_METHODS,
} from './schema';

/** A single, one-way schema change. */
type Migration = {
  version: number;
  migrate: (db: SQLiteDatabase) => Promise<void>;
};

/**
 * Every schema change, in order.
 *
 * Rules for editing this list:
 *   - never change a migration that has shipped — add a new one;
 *   - never drop a table that holds user data (rename into a new table and
 *     copy the rows instead);
 *   - `migrate` runs inside a transaction, so a failure leaves no half-applied
 *     schema behind.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    migrate: async (db) => {
      await db.execAsync(SCHEMA_V1);
      await seedFirstRunData(db);
    },
  },
];

/** Reads the schema version SQLite has recorded for this file. */
export async function getDatabaseVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to `DATABASE_VERSION`.
 *
 * Safe to call on every launch: it is a no-op once the file is current. Wired
 * into `SQLiteProvider`'s `onInit`, which runs before any screen can query.
 */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  // Write-ahead logging survives crashes better and lets reads continue while
  // a write is in progress.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  // Off by default in SQLite; without this, our REFERENCES clauses would be
  // ignored and a category could be deleted while transactions still use it.
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const currentVersion = await getDatabaseVersion(db);

  if (currentVersion > DATABASE_VERSION) {
    // The app was downgraded. Refusing to continue is the only safe answer:
    // writing old-shaped data into a newer database would corrupt it.
    throw new Error(
      `Database version ${currentVersion} is newer than this app supports (${DATABASE_VERSION}). ` +
        'Please update PesaTrack.'
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    await db.withTransactionAsync(async () => {
      await migration.migrate(db);
      // Recorded inside the same transaction as the schema change, so the two
      // can never disagree — not even if the app is killed mid-migration.
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    });
  }
}

/**
 * Creates the settings row and the starter categories and payment methods.
 *
 * Runs once, as part of migration 1 — not on every launch, so a user who
 * deactivates a category does not get it back the next time they open the app.
 * Only a name and a type are stored; nothing here is sample financial data.
 */
async function seedFirstRunData(db: SQLiteDatabase): Promise<void> {
  const timestamp = nowIso();

  await insertDefaultSettingsRow(db);

  const insertCategory = await db.prepareAsync(
    `INSERT INTO categories (
       id, name, type, icon, default_need_want, is_default, is_active, sort_order, created_at
     ) VALUES ($id, $name, $type, $icon, $defaultNeedWant, 1, 1, $sortOrder, $createdAt);`
  );

  try {
    for (const [index, category] of SEED_CATEGORIES.entries()) {
      await insertCategory.executeAsync({
        $id: createId(),
        $name: category.name,
        $type: category.type,
        $icon: category.icon,
        $defaultNeedWant: category.defaultNeedWant,
        $sortOrder: index,
        $createdAt: timestamp,
      });
    }
  } finally {
    await insertCategory.finalizeAsync();
  }

  const insertPaymentMethod = await db.prepareAsync(
    `INSERT INTO payment_methods (id, name, is_default, is_active, sort_order, created_at)
     VALUES ($id, $name, $isDefault, 1, $sortOrder, $createdAt);`
  );

  try {
    for (const [index, name] of SEED_PAYMENT_METHODS.entries()) {
      await insertPaymentMethod.executeAsync({
        $id: createId(),
        $name: name,
        $isDefault: name === DEFAULT_PAYMENT_METHOD_NAME ? 1 : 0,
        $sortOrder: index,
        $createdAt: timestamp,
      });
    }
  } finally {
    await insertPaymentMethod.finalizeAsync();
  }
}
