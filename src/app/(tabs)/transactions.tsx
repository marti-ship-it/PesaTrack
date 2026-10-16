import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { FloatingActionButton } from '@/components/floating-action-button';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { TransactionRow } from '@/components/transaction-row';
import { Spacing } from '@/constants/theme';
import { listCategories } from '@/db/repositories/categories';
import { listTransactions } from '@/db/repositories/transactions';
import { useTheme } from '@/hooks/use-theme';
import type { Category, Transaction } from '@/types/models';
import { getErrorMessage } from '@/utils/errors';

/**
 * Transactions — the history of everything recorded.
 *
 * The list reloads every time the screen regains focus, so a transaction added
 * or edited in the modal form is reflected the moment the user returns. Retired
 * categories are loaded too, because an old row may still point at one.
 */
export default function TransactionsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoriesById, setCategoriesById] = useState<Record<string, Category>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, categories] = await Promise.all([
        listTransactions(db, { limit: 200 }),
        listCategories(db, { includeInactive: true }),
      ]);
      setTransactions(rows);
      setCategoriesById(Object.fromEntries(categories.map((category) => [category.id, category])));
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setStatus('error');
    }
  }, [db]);

  // Reload on focus; keep showing the last list while it refreshes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function openNew() {
    router.push('/transaction-form');
  }

  function openEdit(id: string) {
    router.push({ pathname: '/transaction-form', params: { id } });
  }

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  } else if (status === 'error') {
    body = (
      <EmptyState
        title="Could not load your transactions"
        message={error ?? 'Something went wrong.'}
        action={<Button label="Try again" variant="secondary" onPress={() => void load()} />}
      />
    );
  } else if (transactions.length === 0) {
    body = (
      <EmptyState
        title="No transactions yet"
        message="Record your first income, expense or saving. It will appear here, newest first."
        action={<Button label="Add your first transaction" onPress={openNew} />}
      />
    );
  } else {
    body = (
      <Card>
        {transactions.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            category={categoriesById[transaction.categoryId] ?? null}
            onPress={() => openEdit(transaction.id)}
          />
        ))}
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenScaffold title="Transactions" subtitle="Every income, expense and saving you record.">
        {body}
      </ScreenScaffold>
      <FloatingActionButton onPress={openNew} label="Add transaction" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
});
