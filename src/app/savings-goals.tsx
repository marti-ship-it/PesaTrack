import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/form';
import { GoalRow } from '@/components/goal-row';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getSavingsGoalsData, type SavingsGoalsData } from '@/services/savings';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits } from '@/utils/money';

/**
 * Savings goals — money set aside for a purpose, and progress towards it.
 *
 * Two things are worth knowing when reading this screen:
 *
 *   1. **A goal holds no money of its own.** Its balance is derived from its
 *      opening balance plus the `saving` transactions linked to it. So adding
 *      money here does not write to a goal — it opens the transaction form, and
 *      the transaction is the record. That is why "Add money" leads to the
 *      ordinary form rather than a bespoke dialog.
 *   2. **Nothing is deleted.** A goal that has served its purpose is archived,
 *      which hides it from pickers while keeping the transactions that point at
 *      it, so the history of where savings went stays intact.
 *
 * The list reloads on focus, so returning from the transaction form shows the
 * new balance without any manual refresh.
 */
export default function SavingsGoalsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [data, setData] = useState<SavingsGoalsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isCancelled = false;

      async function load() {
        try {
          const next = await getSavingsGoalsData(db);
          if (!isCancelled) {
            setData(next);
            setError(null);
          }
        } catch (loadError) {
          if (!isCancelled) {
            setError(getErrorMessage(loadError));
          }
        } finally {
          if (!isCancelled) {
            setIsLoading(false);
          }
        }
      }

      void load();

      return () => {
        isCancelled = true;
      };
    }, [db])
  );

  /** Records money moving in or out of a goal, through the transaction form. */
  function recordContribution(goalId: string, direction: 'in' | 'out') {
    router.push(`/transaction-form?savingsGoalId=${goalId}&savingDirection=${direction}`);
  }

  function openGoalForm(id?: string) {
    router.push(id ? `/savings-goal-form?id=${id}` : '/savings-goal-form');
  }

  const money = (amount: number) =>
    formatMinorUnits(amount, { symbol: data?.currencySymbol ?? 'KSh' });

  let body: ReactNode;

  if (isLoading && !data) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  } else if (error && !data) {
    body = (
      <Card>
        <ThemedText type="smallBold">Could not load your goals</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {error}
        </ThemedText>
      </Card>
    );
  } else if (data && data.active.length === 0 && data.archived.length === 0) {
    body = (
      <EmptyState
        title="No savings goals yet"
        message="A goal is a target you save towards, like an emergency fund or a new phone. You can keep saving without one too — a goal is just how you watch the progress."
        action={<Button label="Create a goal" onPress={() => openGoalForm()} />}
      />
    );
  } else if (data) {
    body = (
      <>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Held in goals
          </ThemedText>
          <ThemedText type="subtitle">{money(data.totals.savedMinorUnits)}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            {`${data.totals.goalCount} goal${data.totals.goalCount === 1 ? '' : 's'}, aiming for ${money(
              data.totals.targetMinorUnits
            )} in total.`}
          </ThemedText>
        </Card>

        {data.active.map((summary) => (
          <GoalRow
            key={summary.goal.id}
            summary={summary}
            currencySymbol={data.currencySymbol}
            onPress={() => openGoalForm(summary.goal.id)}
            onAddMoney={() => recordContribution(summary.goal.id, 'in')}
            onWithdraw={() => recordContribution(summary.goal.id, 'out')}
          />
        ))}

        <Button label="Add a goal" variant="secondary" onPress={() => openGoalForm()} />

        {data.archived.length > 0 ? (
          <View style={styles.archivedBlock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show archived goals"
              onPress={() => setShowArchived((previous) => !previous)}
              style={({ pressed }) => [styles.archivedHeader, pressed ? styles.pressed : null]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {`Archived (${data.archived.length})`}
              </ThemedText>
              <Ionicons
                name={showArchived ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.textMuted}
              />
            </Pressable>

            {showArchived ? (
              <>
                <ThemedText type="small" themeColor="textMuted">
                  Archived goals still hold their money and keep their history. Open one to restore it.
                </ThemedText>
                {data.archived.map((summary) => (
                  <Pressable
                    key={summary.goal.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Archived goal ${summary.goal.name}`}
                    onPress={() => openGoalForm(summary.goal.id)}
                    style={({ pressed }) => [
                      styles.archivedRow,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                      pressed ? styles.pressed : null,
                    ]}>
                    <View style={styles.archivedText}>
                      <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
                        {summary.goal.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textMuted">
                        {`${money(summary.savedMinorUnits)} saved`}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </Pressable>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
      </>
    );
  } else {
    body = null;
  }

  return (
    <ScreenScaffold
      title="Savings goals"
      subtitle="Money set aside, and how close you are to each target."
      onBack={() => router.back()}>
      {body}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  archivedBlock: {
    gap: Spacing.two,
  },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  archivedText: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
});
