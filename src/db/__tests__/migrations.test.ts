/**
 * Tests the migration runner's decisions.
 *
 * The SQL itself is verified in `schema.test.ts`; what matters here is the
 * bookkeeping around it, because getting that wrong destroys user data:
 *
 *   - a fresh database is created and stamped;
 *   - an up-to-date database is left completely alone;
 *   - a database from a *newer* app version is refused rather than mangled;
 *   - the schema change and its version stamp are committed together.
 *
 * The database is faked with a Jest mock that records the SQL it receives, so
 * these tests run in milliseconds and need no native module.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabaseVersion, migrateDatabase } from '../migrations';
import { DATABASE_VERSION, SCHEMA_V1, SEED_CATEGORIES } from '../schema';

type FakeDatabase = {
  db: SQLiteDatabase;
  statements: string[];
  transactionCount: number;
  getVersion: () => number;
};

function createFakeDatabase(initialVersion: number): FakeDatabase {
  const statements: string[] = [];
  let version = initialVersion;
  let transactionCount = 0;

  const fake = {
    execAsync: async (sql: string) => {
      statements.push(sql);
      const stamped = /PRAGMA user_version = (\d+);/.exec(sql);
      if (stamped) {
        version = Number(stamped[1]);
      }
    },
    getFirstAsync: async () => ({ user_version: version }),
    runAsync: async () => ({ changes: 1, lastInsertRowId: 1 }),
    prepareAsync: async () => ({
      executeAsync: async () => ({ changes: 1, lastInsertRowId: 1 }),
      finalizeAsync: async () => undefined,
    }),
    withTransactionAsync: async (task: () => Promise<void>) => {
      transactionCount += 1;
      await task();
    },
  };

  return {
    db: fake as unknown as SQLiteDatabase,
    statements,
    get transactionCount() {
      return transactionCount;
    },
    getVersion: () => version,
  } as FakeDatabase;
}

describe('getDatabaseVersion', () => {
  it('reads the version SQLite recorded', async () => {
    const fake = createFakeDatabase(0);
    expect(await getDatabaseVersion(fake.db)).toBe(0);
  });
});

describe('migrateDatabase', () => {
  it('creates the schema and stamps the version on a fresh database', async () => {
    const fake = createFakeDatabase(0);

    await migrateDatabase(fake.db);

    expect(fake.statements).toContain(SCHEMA_V1);
    expect(fake.getVersion()).toBe(DATABASE_VERSION);
  });

  it('enables write-ahead logging and foreign keys before migrating', async () => {
    const fake = createFakeDatabase(0);

    await migrateDatabase(fake.db);

    // Journal mode is the first statement, so it is set before the schema.
    expect(fake.statements[0]).toBe('PRAGMA journal_mode = WAL;');
    expect(fake.statements).toContain('PRAGMA foreign_keys = ON;');
  });

  it('seeds every starter category', async () => {
    const fake = createFakeDatabase(0);
    const seeded: unknown[] = [];

    // Count how many rows the seeder inserts through prepared statements.
    const originalPrepare = fake.db.prepareAsync.bind(fake.db);
    fake.db.prepareAsync = (async (sql: string) => {
      const statement = await originalPrepare(sql);
      return {
        ...statement,
        executeAsync: async (params: Record<string, unknown>) => {
          seeded.push(params);
          return { changes: 1, lastInsertRowId: 1 };
        },
      };
    }) as typeof fake.db.prepareAsync;

    await migrateDatabase(fake.db);

    const categoryRows = seeded.filter((params) => '$type' in (params as object));
    expect(categoryRows).toHaveLength(SEED_CATEGORIES.length);
  });

  it('does nothing to a database that is already current', async () => {
    const fake = createFakeDatabase(DATABASE_VERSION);

    await migrateDatabase(fake.db);

    expect(fake.statements).not.toContain(SCHEMA_V1);
    expect(fake.transactionCount).toBe(0);
    expect(fake.getVersion()).toBe(DATABASE_VERSION);
  });

  it('stamps the version inside the same transaction as the schema change', async () => {
    const fake = createFakeDatabase(0);

    await migrateDatabase(fake.db);

    // One transaction, and the stamp happened as part of it: if the app were
    // killed mid-migration, the two could not disagree.
    expect(fake.transactionCount).toBe(1);
    expect(fake.getVersion()).toBe(DATABASE_VERSION);
  });

  it('refuses to open a database created by a newer version of the app', async () => {
    const fake = createFakeDatabase(DATABASE_VERSION + 1);

    await expect(migrateDatabase(fake.db)).rejects.toThrow(/newer than this app supports/);
    expect(fake.statements).not.toContain(SCHEMA_V1);
  });
});
