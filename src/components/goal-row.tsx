import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Button } from '@/components/form';
import { ProgressBar } from '@/components/progress-bar';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { goalTargetDateHint, type GoalSummary } from '@/services/savings';
import { formatMinorUnits } from '@/utils/money';

type GoalRowProps = {
  summary: GoalSummary;
  /** Currency symbol, taken from stored settings rather than assumed. */
  currencySymbol: string;
  /** Opens the goal for editing. */
  onPress: () => void;
  /** Records a contribution — an ordinary `saving` transaction. */
  onAddMoney: () => void;
  /** Records a withdrawal. */
  onWithdraw: () => void;
};

/**
 * One savings goal: name, progress towards the target, and the two actions that
 * move money.
 *
 * A goal fills *up* towards its target, the opposite of a budget being spent
 * down towards its limit, so the bar takes the savings colour and turns to the
 * income colour once the target is reached — a change of state, not a warning.
 *
 * "Add money" and "Withdraw" are on the row rather than buried in the edit form
 * because they are what a goal is *for*: adding to it should not take four taps.
 */
export function GoalRow({ summary, currencySymbol, onPress, onAddMoney, onWithdraw }: GoalRowProps) {
  const theme = useTheme();
  const {
    goal,
    savedMinorUnits,
    targetMinorUnits,
    remainingMinorUnits,
    surplusMinorUnits,
    percentOfTarget,
    progress,
    isReached,
  } = summary;

  const dateHint = goalTargetDateHint(goal.targetDate);
  const money = (amount: number) => formatMinorUnits(amount, { symbol: currencySymbol });

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${goal.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.head, pressed ? styles.pressed : null]}>
        <View style={styles.titleGroup}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {goal.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            {dateHint ?? 'No target date'}
          </ThemedText>
        </View>

        {isReached ? (
          <View style={[styles.badge, { backgroundColor: theme.primaryMuted }]}>
            <Ionicons name="checkmark-circle" size={14} color={theme.income} />
            <ThemedText type="smallBold" themeColor="income">
              Reached
            </ThemedText>
          </View>
        ) : null}

        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </Pressable>

      <ProgressBar progress={progress} color={isReached ? theme.income : theme.savings} />

      <View style={styles.amounts}>
        <ThemedText type="small" themeColor="textSecondary">
          {`${money(savedMinorUnits)} of ${money(targetMinorUnits)}`}
        </ThemedText>
        <ThemedText type="smallBold" themeColor={isReached ? 'income' : 'textSecondary'}>
          {`${Math.round(percentOfTarget)}%`}
        </ThemedText>
      </View>

      <ThemedText type="small" themeColor="textMuted">
        {isReached
          ? `${money(surplusMinorUnits)} past your target.`
          : `${money(remainingMinorUnits)} to go.`}
      </ThemedText>

      <View style={styles.actions}>
        <Button label="Add money" onPress={onAddMoney} style={styles.action} />
        <Button
          label="Withdraw"
          variant="secondary"
          onPress={onWithdraw}
          disabled={savedMinorUnits <= 0}
          style={styles.action}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleGroup: {
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  amounts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
