import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { balanceEffectMinorUnits } from '@/services/transactions';
import type { Category, Transaction } from '@/types/models';
import { formatDateLabel } from '@/utils/dates';
import { formatMinorUnits } from '@/utils/money';

type TransactionRowProps = {
  transaction: Transaction;
  category?: Category | null;
  onPress: () => void;
};

/** Fallback icons when a category has no icon of its own. */
const TYPE_ICONS: Record<Transaction['type'], IoniconName> = {
  income: 'arrow-down-circle-outline',
  expense: 'arrow-up-circle-outline',
  saving: 'wallet-outline',
};

/**
 * One transaction in the history list.
 *
 * The amount is shown signed the way it affects the *available balance*: income
 * adds, an expense subtracts, a refund adds back (it returns money), and moving
 * money into savings subtracts (it left the spendable balance) while moving it
 * out adds. Colour repeats the meaning but the sign and the label are always
 * present, so the row is readable without it.
 */
export function TransactionRow({ transaction, category, onPress }: TransactionRowProps) {
  const theme = useTheme();
  // A refund is an expense row that gives money back, so it reads as income.
  const isRefund = transaction.refundOfTransactionId !== null;
  // The theme token is `savings` (plural) while the transaction type is
  // `saving` (singular), so map explicitly rather than indexing by type name.
  const color =
    isRefund || transaction.type === 'income'
      ? theme.income
      : transaction.type === 'expense'
        ? theme.expense
        : theme.savings;

  const signedAmount = balanceEffectMinorUnits(transaction);
  const amountText = formatMinorUnits(signedAmount, { showSign: true });

  const contextLabel = transaction.type === 'saving'
    ? `Savings ${transaction.savingDirection === 'out' ? 'out' : 'in'}`
    : (category?.name ?? 'Uncategorised');

  const icon: IoniconName = (category?.icon as IoniconName | null) ?? TYPE_ICONS[transaction.type];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>

      <View style={styles.details}>
        <ThemedText type="default" numberOfLines={1}>
          {transaction.description}
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
          {contextLabel} · {formatDateLabel(transaction.date)}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" style={{ color }}>
        {amountText}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
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
});
