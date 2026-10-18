/**
 * Verifies the export and backup formats in `services/backup.ts`.
 *
 * These are the rules that decide whether a CSV opens cleanly in a spreadsheet
 * and whether a file the user picked is a PesaTrack backup at all, so they are
 * tested directly rather than by driving a screen.
 */
import { BACKUP_TABLES, DATABASE_VERSION, type BackupRow, type BackupTables } from '@/db/schema';
import {
  BACKUP_FORMAT_VERSION,
  backupFileName,
  buildBackupFile,
  buildTransactionsCsv,
  parseBackupFile,
  serializeBackupFile,
  transactionsCsvFileName,
} from '@/services/backup';
import type { Transaction } from '@/types/models';

const EXPORTED_AT = '2026-10-17T08:30:00.000Z';

/** A `tables` object with every table present but empty. */
function emptyTables(): BackupTables {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table.name, [] as BackupRow[]]));
}

function tablesWith(overrides: BackupTables): BackupTables {
  return { ...emptyTables(), ...overrides };
}

/** A raw transaction row as the database would hand it over. */
function transactionRow(overrides: BackupRow = {}): BackupRow {
  return {
    id: 'tx-1',
    type: 'expense',
    amount_minor_units: 125050,
    date: '2026-10-15',
    description: 'Lunch',
    notes: null,
    category_id: 'cat-food',
    need_want: 'need',
    payment_method_id: 'pm-1',
    saving_direction: null,
    savings_goal_id: null,
    refund_of_transaction_id: null,
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    ...overrides,
  };
}

/** A raw backup object, built by hand so it can be deliberately wrong. */
function rawBackup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: 'PesaTrack',
    format: BACKUP_FORMAT_VERSION,
    schemaVersion: DATABASE_VERSION,
    exportedAt: EXPORTED_AT,
    counts: {},
    tables: emptyTables(),
    ...overrides,
  };
}

describe('buildBackupFile', () => {
  it('counts the rows in each table and stamps the current data version', () => {
    const backup = buildBackupFile(
      tablesWith({ transactions: [transactionRow(), transactionRow({ id: 'tx-2' })], categories: [{ id: 'cat-food' }] }),
      { exportedAt: EXPORTED_AT }
    );

    expect(backup.app).toBe('PesaTrack');
    expect(backup.format).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.schemaVersion).toBe(DATABASE_VERSION);
    expect(backup.exportedAt).toBe(EXPORTED_AT);
    expect(backup.counts.transactions).toBe(2);
    expect(backup.counts.categories).toBe(1);
    expect(backup.counts.settings).toBe(0);
  });
});

describe('serializeBackupFile and parseBackupFile', () => {
  it('writes a backup that reads back exactly as it was', () => {
    const tables = tablesWith({
      transactions: [transactionRow()],
      savings_goals: [{ id: 'goal-1', name: 'Emergency' }],
    });
    const text = serializeBackupFile(buildBackupFile(tables, { exportedAt: EXPORTED_AT }));

    const parsed = parseBackupFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.backup.tables).toEqual(tables);
    expect(parsed.backup.exportedAt).toBe(EXPORTED_AT);
    expect(parsed.backup.counts.transactions).toBe(1);
  });

  it('refuses a file that is not readable as JSON', () => {
    const parsed = parseBackupFile('this is not json');
    expect(parsed.ok).toBe(false);
  });

  it('refuses JSON that is not a PesaTrack backup', () => {
    const parsed = parseBackupFile(
      JSON.stringify(rawBackup({ app: 'SomeOtherApp', format: 1 }))
    );
    expect(parsed.ok).toBe(false);
  });

  it('refuses a backup made by a newer version of the app', () => {
    const parsed = parseBackupFile(
      JSON.stringify(rawBackup({ schemaVersion: DATABASE_VERSION + 1 }))
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('newer version');
  });

  it('refuses a backup that is missing a table', () => {
    const { settings, ...incomplete } = emptyTables();
    expect(settings).toBeDefined();

    const parsed = parseBackupFile(JSON.stringify(rawBackup({ tables: incomplete })));
    expect(parsed.ok).toBe(false);
  });

  it('refuses a row that carries something other than text, a number or null', () => {
    const parsed = parseBackupFile(
      JSON.stringify(
        rawBackup({
          tables: tablesWith({ categories: [{ id: 'cat-food', name: true as unknown as string }] }),
        })
      )
    );
    expect(parsed.ok).toBe(false);
  });

  it('re-derives the counts from the rows rather than trusting the file', () => {
    const parsed = parseBackupFile(
      JSON.stringify(
        rawBackup({
          counts: { transactions: 99 },
          tables: tablesWith({ transactions: [transactionRow()] }),
        })
      )
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.counts.transactions).toBe(1);
  });
});

describe('buildTransactionsCsv', () => {
  const lookups = {
    currencyCode: 'KES',
    categoriesById: { 'cat-food': 'Food', 'cat-savings': 'Savings' },
    paymentMethodsById: { 'pm-1': 'M-Pesa' },
    savingsGoalsById: { 'goal-1': 'Emergency fund' },
  };

  function transaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 'tx-1',
      type: 'expense',
      amountMinorUnits: 125050,
      date: '2026-10-15',
      description: 'Lunch',
      notes: null,
      categoryId: 'cat-food',
      needWant: 'need',
      paymentMethodId: 'pm-1',
      savingDirection: null,
      savingsGoalId: null,
      refundOfTransactionId: null,
      createdAt: EXPORTED_AT,
      updatedAt: EXPORTED_AT,
      ...overrides,
    };
  }

  it('writes only the header when there is nothing to export', () => {
    expect(buildTransactionsCsv([], lookups)).toBe(
      'date,type,description,category,payment_method,need_want,saving_direction,savings_goal,amount,currency,is_refund,notes\r\n'
    );
  });

  it('resolves ids to names and formats money as a plain decimal', () => {
    const csv = buildTransactionsCsv([transaction()], lookups);
    const line = csv.split('\r\n')[1];

    expect(line).toBe('2026-10-15,expense,Lunch,Food,M-Pesa,need,,,1250.50,KES,no,');
  });

  it('quotes fields containing a comma, a quote or a line break', () => {
    const csv = buildTransactionsCsv(
      [transaction({ description: 'Lunch, "big"', notes: 'line one\nline two' })],
      lookups
    );
    const line = csv.split('\r\n')[1];

    expect(line).toBe(
      '2026-10-15,expense,"Lunch, ""big""",Food,M-Pesa,need,,,1250.50,KES,no,"line one\nline two"'
    );
  });

  it('carries a saving transaction’s direction and goal', () => {
    const csv = buildTransactionsCsv(
      [
        transaction({
          type: 'saving',
          categoryId: 'cat-savings',
          description: 'Withdrawal',
          amountMinorUnits: 60000,
          needWant: null,
          paymentMethodId: null,
          savingDirection: 'out',
          savingsGoalId: 'goal-1',
        }),
      ],
      lookups
    );

    expect(csv.split('\r\n')[1]).toBe(
      '2026-10-15,saving,Withdrawal,Savings,,,out,Emergency fund,600.00,KES,no,'
    );
  });

  it('flags a refund', () => {
    const csv = buildTransactionsCsv(
      [transaction({ refundOfTransactionId: 'tx-0' })],
      lookups
    );

    expect(csv.split('\r\n')[1]).toContain(',yes,');
  });
});

describe('file names', () => {
  it('are dated so backups sort chronologically', () => {
    expect(backupFileName('2026-10-17')).toBe('pesatrack-backup-2026-10-17.json');
    expect(transactionsCsvFileName('2026-10-17')).toBe('pesatrack-transactions-2026-10-17.csv');
  });
});
