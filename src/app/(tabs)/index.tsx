import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Button, SegmentedControl, type SegmentOption } from '@/components/form';
import { ProgressBar } from '@/components/progress-bar';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { Spacing } from '@/constants/theme';
import { listCategories } from '@/db/repositories/categories';
import { listTransactions } from '@/db/repositories/transactions';
import { useTheme } from '@/hooks/use-theme';
import {
  getDashboardData,
  type DashboardData,
  type DashboardPeriod,
} from '@/services/dashboard';
import { getSavingsGoalsData, pickFeaturedGoal, type SavingsGoalsData } from '@/services/savings';
import type { Category, Transaction } from '@/types/models';
import { formatDateLabel } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits } from '@/utils/money';

/**
 * Home — the dashboard built from real saved transactions.
 *
 * Every number comes from `getDashboardData`: one SQL pass for the selected
 * period, one for all time (the balance), straight out of the database. The
 * screen reloads whenever it regains focus, so a transaction saved in the form
 * modal updates Home the moment the user comes back — no manual refresh.
 *
 * The balance is always a point in time (all records); the three totals
 * describe the selected period (financial month or all time). Savings appear
 * as their own tile because a saving moves money between pots instead of
 * spending it, so folding it into expenses would double-count it.
 */

const PERIOD_OPTIONS: readonly SegmentOption<DashboardPeriod>[] = [
  { value: 'financial-month', label: 'Financial month' },
  { value: 'all-time', label: 'All time' },
];

/** How many rows the "Recent transactions" list shows. */
const RECENT_LIMIT = 5;

type SummaryRowProps = {
  label: string;
  amountText: string;
  color: string;
};

/** One line of the period summary: label left, coloured amount right. */
function SummaryRow({ label, amountText, color }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
        {label}
      </ThemedText>
      <ThemedText
        type="default"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.summaryAmount, { color }]}>
        {amountText}
      </ThemedText>
    </View>
  );
}

export default function HomeScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [period, setPeriod] = useState<DashboardPeriod>('financial-month');
  const [data, setData] = useState<DashboardData | null>(null);
  const [goals, setGoals] = useState<SavingsGoalsData | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [categoriesById, setCategoriesById] = useState<Record<string, Category>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // A quick period switch can start a second load before the first finishes;
  // only the newest request may touch the screen, so stale totals never land
  // under the wrong period.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentId = ++requestId.current;
    try {
      const [dashboard, rows, categories, goalData] = await Promise.all([
        getDashboardData(db, period),
        listTransactions(db, { limit: RECENT_LIMIT }),
        listCategories(db, { includeInactive: true }),
        getSavingsGoalsData(db),
      ]);
      if (currentId !== requestId.current) {
        return;
      }
      setData(dashboard);
      setRecent(rows);
      setCategoriesById(Object.fromEntries(categories.map((category) => [category.id, category])));
      setGoals(goalData);
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      if (currentId !== requestId.current) {
        return;
      }
      setError(getErrorMessage(loadError));
      setStatus('error');
    }
  }, [db, period]);

  // Reload on focus and whenever the period changes; keep showing the last
  // numbers while it refreshes.
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
  } else if (status === 'error' || !data) {
    body = (
      <EmptyState
        title="Could not load your dashboard"
        message={error ?? 'Something went wrong.'}
        action={<Button label="Try again" variant="secondary" onPress={() => void load()} />}
      />
    );
  } else {
    const { totals } = data;
    const money = (amount: number) => formatMinorUnits(amount, { symbol: data.currencySymbol });
    const hasNoTransactions = data.transactionCount === 0;
    const featuredGoal = goals ? pickFeaturedGoal(goals.active) : null;

    body = (
      <>
        {hasNoTransactions ? null : (
          <>
            <SegmentedControl
              label="Period"
              options={PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
            />
            <ThemedText type="small" themeColor="textMuted">
              {data.range
                ? `${formatDateLabel(data.range.start)} – ${formatDateLabel(data.range.end)}`
                : 'Every recorded transaction'}
            </ThemedText>
          </>
        )}

        <Card title="Current balance">
          <ThemedText type="title" numberOfLines={1} adjustsFontSizeToFit>
            {money(totals.currentBalanceMinorUnits)}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            Cash on hand from every record. Your savings pot is counted separately.
          </ThemedText>
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open savings goals"
          onPress={() => router.push('/savings-goals')}
          style={({ pressed }) => (pressed ? styles.pressed : null)}>
          <Card title="Savings goals">
            {featuredGoal ? (
              <>
                <View style={styles.goalHead}>
                  <ThemedText type="default" numberOfLines={1} style={styles.goalName}>
                    {featuredGoal.goal.name}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    themeColor={featuredGoal.isReached ? 'income' : 'textSecondary'}>
                    {`${Math.round(featuredGoal.percentOfTarget)}%`}
                  </ThemedText>
                </View>
                <ProgressBar
                  progress={featuredGoal.progress}
                  color={featuredGoal.isReached ? theme.income : theme.savings}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {`${money(featuredGoal.savedMinorUnits)} of ${money(
                    featuredGoal.targetMinorUnits
                  )}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {`${
                    featuredGoal.isReached ? 'Target reached' : 'Closest to its target'
                  } · ${money(goals?.totals.savedMinorUnits ?? 0)} saved in total.`}
                </ThemedText>
              </>
            ) : (
              <ThemedText type="small" themeColor="textMuted">
                No goals yet. Set a target, and watch it fill up as you save.
              </ThemedText>
            )}
          </Card>
        </Pressable>

        {hasNoTransactions ? (
          <EmptyState
            title="No transactions yet"
            message="Record your first income, expense or saving to see your balance and totals here."
            action={<Button label="Add your first transaction" onPress={openNew} />}
          />
        ) : (
          <>
            <Card title={`Totals for ${data.periodLabel}`}>
              <SummaryRow
                label="Total income"
                amountText={money(totals.totalIncomeMinorUnits)}
                color={theme.income}
              />
              <SummaryRow
                label="Total expenses"
                amountText={money(totals.totalExpensesMinorUnits)}
                color={theme.expense}
              />
              <SummaryRow
                label="Saved this period"
                amountText={money(totals.savedThisPeriodMinorUnits)}
                color={theme.savings}
              />
              <ThemedText type="small" themeColor="textMuted">
                Expenses are net of refunds. Savings move money out of your balance — they are
                not spending.
              </ThemedText>
            </Card>

            <Card title="Recent transactions">
              {recent.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  category={categoriesById[transaction.categoryId] ?? null}
                  onPress={() => openEdit(transaction.id)}
                />
              ))}
            </Card>
            <Button
              label="See all transactions"
              variant="secondary"
              onPress={() => router.push('/transactions')}
            />
          </>
        )}
      </>
    );
  }

  return (
    <ScreenScaffold title="Home" subtitle="Your money at a glance, from your own records.">
      {body}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  summaryLabel: {
    flexShrink: 1,
  },
  summaryAmount: {
    fontWeight: '700',
    textAlign: 'right',
    // Lets a long amount shrink instead of clipping on very narrow screens.
    flexShrink: 1,
  },
  goalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  goalName: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
