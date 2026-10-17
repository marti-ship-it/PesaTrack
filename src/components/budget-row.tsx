import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BudgetStatus, CategoryBudgetRow } from '@/services/budgets';
import { formatMinorUnits } from '@/utils/money';

type BudgetRowProps = {
  row: CategoryBudgetRow;
  /** Symbol for the user's currency, from settings. */
  currencySymbol: string;
  onPress: () => void;
};

/** Fallback icon when a category has none of its own. */
const FALLBACK_ICON: IoniconName = 'pricetag-outline';

/**
 * The colour a budget status is drawn in.
 *
 * The meaning is always repeated in words by `statusLabel`, so the colour is a
 * reinforcement rather than the only signal — the same rule the transaction
 * rows follow.
 */
function statusColor(status: BudgetStatus, theme: ReturnType<typeof useTheme>): string {
  switch (status) {
    case 'exceeded':
      return theme.expense;
    case 'reached':
    case 'near':
      return theme.warning;
    case 'under':
      return theme.income;
  }
}

/** A short, plain-language reading of the status. */
function statusLabel(status: BudgetStatus): string {
  switch (status) {
    case 'exceeded':
      return 'Over budget';
    case 'reached':
      return 'Budget used up';
    case 'near':
      return 'Close to the limit';
    case 'under':
      return 'Under budget';
  }
}

/**
 * One category budget: its icon and name, how much has been spent against the
 * limit, a progress track, and the amount left (or overspent).
 *
 * The row is the whole tap target and opens the form for that category. The
 * percentage shown is clamped at 0 so a refund-heavy month never displays a
 * negative figure; the footer carries the honest "left" amount instead.
 */
export function BudgetRow({ row, currencySymbol, onPress }: BudgetRowProps) {
  const theme = useTheme();
  const color = statusColor(row.status, theme);
  const icon: IoniconName = (row.categoryIcon as IoniconName | null) ?? FALLBACK_ICON;

  const money = (amount: number) => formatMinorUnits(amount, { symbol: currencySymbol });
  const percentText = `${Math.max(0, Math.round(row.percentUsed))}%`;

  const footer =
    row.remainingMinorUnits > 0
      ? `${money(row.remainingMinorUnits)} left`
      : row.remainingMinorUnits === 0
        ? 'Nothing left in this budget'
        : `${money(-row.remainingMinorUnits)} over budget`;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>

        <View style={styles.details}>
          <ThemedText type="default" numberOfLines={1}>
            {row.categoryName}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
            {money(row.spentMinorUnits)} of {money(row.budgetedMinorUnits)}
          </ThemedText>
        </View>

        <ThemedText type="smallBold" style={{ color }}>
          {percentText}
        </ThemedText>
      </View>

      <ProgressBar progress={row.progress} color={color} />

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
          {footer}
        </ThemedText>
        <ThemedText type="small" style={{ color }} numberOfLines={1}>
          {statusLabel(row.status)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    flex: 1,
    gap: Spacing.half,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
