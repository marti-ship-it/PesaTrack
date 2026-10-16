import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { BudgetRow } from '@/components/budget-row';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/form';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getReportsData, hasAnyTransactions, type ReportsData } from '@/services/reports';
import { addMonths, formatDateLabel, formatMonthLabel } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits, formatSignedMinorUnits } from '@/utils/money';

/**
 * Reports — income vs spending, category shares, month-over-month movement
 * and budget performance, all for the selected financial month.
 *
 * Every figure comes from `getReportsData`, which reads with the same SQL the
 * dashboard, transactions list and Budgets screen use:
 *
 *   - expenses are **net of refunds**, so a returned purchase reduces the
 *     spending it reverses instead of counting as new spending;
 *   - **savings transfers never appear** as income or spending (savings
 *     analytics are a later milestone);
 *   - **financial months honour the start-day setting**, exactly like Budgets.
 *
 * The full empty state is shown only when the user has no transactions at
 * all. A month without activity still has real history to summarise, so its
 * zero totals are displayed rather than hidden — but sections that genuinely
 * have nothing (no spending this month, no budgets set, no previous month)
 * say so plainly instead of showing invented figures.
 */

type SummaryRowProps = {
  label: string;
  amountText: string;
  color: string;
  detail?: string;
};

/** One line of a card's summary: label left, coloured amount right. */
function SummaryRow({ label, amountText, color, detail }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryLabelWrap}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textMuted">
            {detail}
          </ThemedText>
        ) : null}
      </View>
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

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  // `null` means "whatever the current financial month is"; once the user
  // steps back we pin an explicit key.
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [data, setData] = useState<ReportsData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may touch the screen.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentId = ++requestId.current;
    try {
      const next = await getReportsData(db, monthKey ?? undefined);
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

  // Reload on focus so a transaction recorded elsewhere shows up here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function shiftMonth(delta: number) {
    const base = data?.monthKey ?? monthKey;
    if (!base) {
      return;
    }
    setMonthKey(addMonths(base, delta));
  }

  function openBudgetForm(categoryId: string, key: string) {
    router.push({ pathname: '/budget-form', params: { monthKey: key, categoryId } });
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
        title="Could not load your reports"
        message={error ?? 'Something went wrong.'}
        action={<Button label="Try again" variant="secondary" onPress={() => void load()} />}
      />
    );
  } else if (!hasAnyTransactions(data.totalTransactionCount)) {
    body = (
      <EmptyState
        title="Record transactions to compare monthly spending"
        message="Category breakdowns, monthly comparisons and budget performance are calculated from your own records, so they need at least one month of data."
      />
    );
  } else {
    const money = (amount: number) => formatMinorUnits(amount, { symbol: data.currencySymbol });
    const hasSpending = data.totals.expensesNetMinorUnits !== 0 || data.breakdown.length > 0;
    const hasSeriesData = data.series.some(
      (entry) => entry.totals.incomeMinorUnits !== 0 || entry.totals.expensesNetMinorUnits !== 0
    );
    const comparison = data.comparison;
    const previousMonthLabel = formatMonthLabel(comparison.previousMonthKey);

    body = (
      <>
        <MonthNavigator
          label={data.monthLabel}
          onPrevious={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
        />
        <ThemedText type="small" themeColor="textMuted">
          {`${formatDateLabel(data.range.start)} - ${formatDateLabel(data.range.end)}`}
        </ThemedText>

        <Card title={`Money in and out — ${data.monthLabel}`}>
          <SummaryRow
            label="Income"
            amountText={money(data.totals.incomeMinorUnits)}
            color={theme.income}
          />
          <SummaryRow
            label="Spent"
            amountText={money(data.totals.expensesNetMinorUnits)}
            color={theme.expense}
            detail="Net of refunds"
          />
          <ThemedText type="small" themeColor="textMuted">
            Savings transfers are movements between pots and are never counted here.
          </ThemedText>
        </Card>

        <Card title={`Compared with ${previousMonthLabel}`}>
          {comparison.hasPreviousData ? (
            <>
              <SummaryRow
                label="Income change"
                amountText={formatSignedMinorUnits(comparison.incomeDeltaMinorUnits, {
                  symbol: data.currencySymbol,
                })}
                color={comparison.incomeDeltaMinorUnits < 0 ? theme.expense : theme.income}
                detail={`vs ${previousMonthLabel}: ${money(comparison.previous.incomeMinorUnits)}`}
              />
              <SummaryRow
                label="Spending change"
                amountText={formatSignedMinorUnits(comparison.expensesDeltaMinorUnits, {
                  symbol: data.currencySymbol,
                })}
                color={comparison.expensesDeltaMinorUnits > 0 ? theme.expense : theme.income}
                detail={`vs ${previousMonthLabel}: ${money(comparison.previous.expensesNetMinorUnits)}`}
              />
            </>
          ) : (
            <ThemedText type="small" themeColor="textMuted">
              {`No transactions in ${previousMonthLabel} yet, so there is nothing to compare against.`}
            </ThemedText>
          )}
        </Card>

        <Card title="Where the money went">
          {hasSpending ? (
            <>
              {data.breakdown.map((row) => (
                <View key={row.categoryId} style={styles.summaryRow}>
                  <View style={styles.summaryLabelWrap}>
                    <ThemedText type="default" numberOfLines={1}>
                      {row.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      {row.netMinorUnits < 0
                        ? 'Money returned'
                        : row.sharePercent !== null
                          ? `${Math.round(row.sharePercent)}% of spending`
                          : ''}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="default"
                    numberOfLines={1}
                    style={[styles.summaryAmount, { color: row.netMinorUnits < 0 ? theme.income : theme.text }]}>
                    {money(row.netMinorUnits)}
                  </ThemedText>
                </View>
              ))}
              <ThemedText type="small" themeColor="textMuted">
                Spending is net of refunds. Retired categories keep their real names.
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textMuted">
              No spending recorded in this period.
            </ThemedText>
          )}
        </Card>

        <Card title="Last six months">
          {hasSeriesData ? (
            data.series.map((entry) => (
              <View key={entry.monthKey} style={styles.summaryRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabelWrap}>
                  {entry.label}
                </ThemedText>
                <ThemedText type="small" numberOfLines={1} style={styles.seriesAmounts}>
                  {`${formatMinorUnits(entry.totals.incomeMinorUnits, {
                    symbol: data.currencySymbol,
                    hideDecimals: true,
                  })} in · ${formatMinorUnits(entry.totals.expensesNetMinorUnits, {
                    symbol: data.currencySymbol,
                    hideDecimals: true,
                  })} out`}
                </ThemedText>
              </View>
            ))
          ) : (
            <ThemedText type="small" themeColor="textMuted">
              No activity in the last six months yet.
            </ThemedText>
          )}
        </Card>

        <Card title={`Budget performance — ${data.monthLabel}`}>
          {data.budgetRows.length > 0 ? (
            data.budgetRows.map((row) => (
              <BudgetRow
                key={row.categoryId}
                row={row}
                currencySymbol={data.currencySymbol}
                onPress={() => openBudgetForm(row.categoryId, data.monthKey)}
              />
            ))
          ) : (
            <ThemedText type="small" themeColor="textMuted">
              No budgets set for this month. Spending against a budget is shown on the Budgets tab.
            </ThemedText>
          )}
        </Card>
      </>
    );
  }

  return (
    <ScreenScaffold title="Reports" subtitle="Where your money comes from and where it goes.">
      {body}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
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
  summaryLabelWrap: {
    flexShrink: 1,
    gap: 2,
  },
  summaryAmount: {
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  seriesAmounts: {
    textAlign: 'right',
    flexShrink: 1,
  },
});
