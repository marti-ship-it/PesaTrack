import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Button } from '@/components/form';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { readAllTables, readCsvExportData, replaceAllTables } from '@/db/repositories/backup';
import {
  backupFileName,
  buildBackupFile,
  buildTransactionsCsv,
  parseBackupFile,
  serializeBackupFile,
  transactionsCsvFileName,
} from '@/services/backup';
import { todayIso } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { nowIso } from '@/utils/ids';

/**
 * Export & backup.
 *
 * Two things a person who cares about their records wants, and one they must be
 * careful with:
 *
 *   1. **Export** turns transactions into a CSV any spreadsheet can open.
 *   2. **Back up** writes the whole database to a single JSON file.
 *   3. **Restore** reads such a file back, replacing everything on the device.
 *
 * The screen itself holds no rules: it asks the pure `services/backup.ts` what
 * the file should say and whether a chosen file is trustworthy, and asks the
 * repository to read or write rows. Its only job is to move bytes onto and off
 * the device and to warn clearly before the destructive step.
 *
 * Files are written to the cache directory and handed straight to the system
 * share sheet. Nothing is uploaded anywhere; the user decides where the file
 * goes, if anywhere.
 */

/** Which long-running action is in progress, so every button can be locked. */
type Action = 'csv' | 'backup' | 'restore';

/** "3 transactions" / "1 transaction". */
function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** Asks the system whether the file can be handed to another app. */
async function shareFile(
  file: File,
  options: { mimeType: string; UTI: string; dialogTitle: string }
): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) {
    return false;
  }
  await Sharing.shareAsync(file.uri, options);
  return true;
}

/** Writes text to a fresh file in the cache directory and returns it. */
function writeCacheFile(name: string, contents: string): File {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(contents);
  return file;
}

/** Resolves once the user has either confirmed the restore or dismissed it. */
function confirmRestore(transactionCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Replace all data?',
      `Restoring a backup replaces everything on this device — currently ` +
        `${plural(transactionCount, 'transaction')} plus all categories, budgets and goals — ` +
        'with the contents of the backup. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export default function BackupScreen() {
  const db = useSQLiteContext();

  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = busy !== null;

  async function handleExportCsv() {
    setBusy('csv');
    setMessage(null);
    setError(null);

    try {
      const data = await readCsvExportData(db);
      const csv = buildTransactionsCsv(data.transactions, {
        currencyCode: data.currencyCode,
        categoriesById: data.categoriesById,
        paymentMethodsById: data.paymentMethodsById,
        savingsGoalsById: data.savingsGoalsById,
      });

      const file = writeCacheFile(transactionsCsvFileName(todayIso()), csv);
      const shared = await shareFile(file, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Export transactions',
      });

      if (!shared) {
        setError('Sharing is not available on this device.');
        return;
      }
      setMessage(`Exported ${plural(data.transactions.length, 'transaction')} as CSV.`);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    } finally {
      setBusy(null);
    }
  }

  async function handleBackup() {
    setBusy('backup');
    setMessage(null);
    setError(null);

    try {
      const tables = await readAllTables(db);
      const backup = buildBackupFile(tables, { exportedAt: nowIso() });

      const file = writeCacheFile(backupFileName(todayIso()), serializeBackupFile(backup));
      const shared = await shareFile(file, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: 'Back up PesaTrack',
      });

      if (!shared) {
        setError('Sharing is not available on this device.');
        return;
      }
      setMessage(
        `Backed up ${plural(backup.counts.transactions ?? 0, 'transaction')} and ` +
          `${plural(backup.counts.savings_goals ?? 0, 'savings goal')}.`
      );
    } catch (backupError) {
      setError(getErrorMessage(backupError));
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    setMessage(null);
    setError(null);
    let restoreError: string | null = null;

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled) {
        return;
      }

      const text = await new File(picked.assets[0].uri).text();
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }

      const confirmed = await confirmRestore(parsed.backup.counts.transactions ?? 0);
      if (!confirmed) {
        return;
      }

      await replaceAllTables(db, parsed.backup.tables);
    } catch (restoreFailure) {
      restoreError = getErrorMessage(restoreFailure);
    } finally {
      setBusy(null);
    }

    if (restoreError) {
      setError(restoreError);
      return;
    }

    setMessage('Backup restored.');
    // Return to the start and let each screen re-read the database it now holds.
    router.replace('/');
  }

  return (
    <ScreenScaffold
      title="Export & backup"
      subtitle="Take your records with you, or bring them back."
      onBack={() => router.back()}>
      <Card title="EXPORT">
        <ThemedText type="small" themeColor="textSecondary">
          Writes your transactions to a CSV file that opens in Excel, Google Sheets or Numbers.
          Categories, payment methods and savings goals are written as names, not codes.
        </ThemedText>
        <Button
          label="Export transactions (CSV)"
          variant="secondary"
          onPress={() => void handleExportCsv()}
          loading={busy === 'csv'}
          disabled={isBusy}
        />
      </Card>

      <Card title="BACKUP">
        <ThemedText type="small" themeColor="textSecondary">
          Writes everything — transactions, categories, budgets, savings goals and settings — to
          one JSON file you can keep somewhere safe and restore later.
        </ThemedText>
        <Button
          label="Back up everything (JSON)"
          onPress={() => void handleBackup()}
          loading={busy === 'backup'}
          disabled={isBusy}
        />
      </Card>

      <Card title="RESTORE">
        <ThemedText type="small" themeColor="textSecondary">
          Reads a backup file back into PesaTrack. This <ThemedText type="smallBold">replaces</ThemedText>{' '}
          all the data currently on this device, so only do it when you mean to. Your records are
          only changed after you confirm.
        </ThemedText>
        <Button
          label="Restore from a backup"
          variant="danger"
          onPress={() => void handleRestore()}
          loading={busy === 'restore'}
          disabled={isBusy}
        />
      </Card>

      <Card>
        <ThemedText type="small" themeColor="textMuted">
          Files are created on this phone. PesaTrack never uploads them, and nothing leaves the
          device unless you choose where to send it in the share sheet.
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          A restored appearance setting takes effect the next time the app is opened.
        </ThemedText>
      </Card>

      <View style={styles.status}>
        {message ? (
          <ThemedText type="small" themeColor="income">
            {message}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText type="small" themeColor="expense">
            {error}
          </ThemedText>
        ) : null}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  status: {
    gap: Spacing.one,
  },
});
