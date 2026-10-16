import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { BudgetRow } from '@/components/budget-row';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { FloatingActionButton } from '@/components/floating-action-button';
import { Button } from '@/components/form';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getBudgetsData, type BudgetsData, type CategorySpendingRow } from '@/services/budgets';
import { addMonths, formatDateLabel } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits } from '@/utils/money';

/**
 * Budgets -?" monthly spending limits per expense category.
 *
 * Every figure comes from `getBudgetsData`: one query for the budgets, one for
 * the net spending per category, joined against the active and retired expense
 * categories. The screen reloads whenever it regains focus, so a budget set in
 * the modal -?" or a refund recorded in the transaction form -?" is reflected the
 * moment the user comes back.
 *
 * Three things the screen deliberately does *not* do:
 *
 *   - it never adds up income or savings against a budget, because the service
 *     filters those out at the query;
 *   - it never invents a budget of zero: a category with no row is shown in the
 *     read-only "No budget set" section instead;
 *   - it never draws a bar past its track: `progress` is already clamped.
 */

type SummaryRowProps = {
  label: string;
  amountText: string;
  color: string;
};

/** One line of the month summary: label left, coloured amount right. */
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

/** A read-only row for a category that has spending but no budget yet. */
function UnbudgetedRow({
  row,
  amountText,
  onPress,
}: {
  row: CategorySpendingRow;
  amountText: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.unbudgetedRow, pressed ? styles.pressed : null]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name="add" size={20} color={theme.textSecondary} />
      </View>
      <View style={styles.unbudgetedDetails}>
        <ThemedText type="default" numberOfLines={1}>
          {row.categoryName}
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
          {`${amountText} spent this month - tap to set a budget`}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

/** The month stepper: previous and next financial months around a label. */
function MonthNavigator({
  label,
  onPrevious,
  onNext,
}: {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.navRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        onPress={onPrevious}
        style={({ pressed }) => [
          styles.navButton,
          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          pressed ? styles.pressed : null,
        ]}>
        <Ionicons name="chevron-back" size={20} color={theme.text} />
      </Pressable>

      <ThemedText type="default" style={styles.navLabel} numberOfLines={1}>
        {label}
      </ThemedText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next month"
        onPress={onNext}
        style={({ pressed }) => [
          styles.navButton,
          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          pressed ? styles.pressed : null,
        ]}>
        <Ionicons name="chevron-forward" size={20} color={theme.text} />
      </Pressable>
    </View>
  );
}

export default function BudgetsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  // `null` means "whatever the current financial month is"; once the user uses
  // the stepper we pin an explicit key.
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [data, setData] = useState<BudgetsData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // A quick tap on the stepper can start a second load before the first
  // finishes; only the newest request may touch the screen.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentId = ++requestId.current;
    try {
      const next = await getBudgetsData(db, monthKey ?? undefined);
      if (currentId !== requestId.current) {
        return;
      }
      setData(next);
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      if (currentId !== requestId.current) {
        return;
      }
      setError(getErrorMessage(loadError));
      setStatus('error');
    }
  }, [db, monthKey]);

  // Reload on focus and whenever the month changes; keep the last numbers while
  // it refreshes.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function openBudgetForm(categoryId?: string) {
    const key = data?.monthKey;
    if (!key) {
      return;
    }
    router.push({
      pathname: '/budget-form',
      params: categoryId ? { monthKey: key, categoryId } : { monthKey: key },
    });
  }

  function shiftMonth(delta: number) {
    const base = data?.monthKey ?? monthKey;
    if (!base) {
      return;
    }
    setMonthKey(addMonths(base, delta));
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
        title="Could not load your budgets"
        message={error ?? 'Something went wrong.'}
        action={<Button label="Try again" variant="secondary" onPress={() => void load()} />}
      />
    );
  } else {
    const money = (amount: number) => formatMinorUnits(amount, { symbol: data.currencySymbol });
    const hasBudgets = data.rows.length > 0;
    const hasUnbudgeted = data.unbudgeted.length > 0;

    body = (
      <>
        <MonthNavigator
          label={data.monthLabel}
          onPrevious={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
        />
        <ThemedText type="small" themeColor="textMuted">
          {`${formatDateLabel(data.range.start)} – ${formatDateLabel(data.range.end)}`}
        </ThemedText>

        {!hasBudgets && !hasUnbudgeted ? (
          <EmptyState
            title={`No budgets set for ${data.monthLabel}`}
            message="Set a monthly limit for a spending category. Budgets apply to expenses only; savings and income are never counted against them."
            action={<Button label="Set a budget" onPress={() => openBudgetForm()} />}
          />
        ) : (
          <>
            {hasBudgets ? (
              <Card title={`Budget for ${data.monthLabel}`}>
                <SummaryRow
                  label="Budgeted"
                  amountText={money(data.totals.budgetedMinorUnits)}
                  color={theme.text}
                />
                <SummaryRow
                  label="Spent"
                  amountText={money(data.totals.spentMinorUnits)}
                  color={theme.expense}
                />
                <SummaryRow
                  label={data.totals.remainingMinorUnits < 0 ? 'Over budget' : 'Remaining'}
                  amountText={money(data.totals.remainingMinorUnits)}
                  color={data.totals.remainingMinorUnits < 0 ? theme.expense : theme.income}
                />
                <ThemedText type="small" themeColor="textMuted">
                  Across {data.rows.length} {data.rows.length === 1 ? 'category' : 'categories'}{' '}
                  with a budget. Spending is net of refunds.
                </ThemedText>
              </Card>
            ) : null}

            {hasBudgets ? (
              <Card title="Your budgets">
                {data.rows.map((row) => (
                  <BudgetRow
                    key={row.categoryId}
                    row={row}
                    currencySymbol={data.currencySymbol}
                    onPress={() => openBudgetForm(row.categoryId)}
                  />
                ))}
              </Card>
            ) : null}

            {hasUnbudgeted ? (
              <Card title="No budget set">
                <ThemedText type="small" themeColor="textMuted">
                  You spent in these categories this month without setting a limit.
                </ThemedText>
                {data.unbudgeted.map((row) => (
                  <UnbudgetedRow
                    key={row.categoryId}
                    row={row}
                    amountText={money(row.spentMinorUnits)}
                    onPress={() => openBudgetForm(row.categoryId)}
                  />
                ))}
              </Card>
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenScaffold title="Budgets" subtitle="Monthly limits for your spending categories.">
        {body}
      </ScreenScaffold>
      <FloatingActionButton onPress={() => openBudgetForm()} label="Set a budget" />
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
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
    flexShrink: 1,
  },
  unbudgetedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  unbudgetedDetails: {
    flex: 1,
    gap: Spacing.half,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
