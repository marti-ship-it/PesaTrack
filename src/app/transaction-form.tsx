import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Button, SegmentedControl, SelectField, TextField } from '@/components/form';
import type { SegmentOption } from '@/components/form';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { listCategories } from '@/db/repositories/categories';
import { getPreferredPaymentMethod, listPaymentMethods } from '@/db/repositories/payment-methods';
import { listSavingsGoals } from '@/db/repositories/savings-goals';
import { getTransactionById } from '@/db/repositories/transactions';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteTransactionSafely,
  saveTransaction,
  transactionToDraft,
} from '@/services/transactions';
import { createEmptyDraft, type FieldErrors, type TransactionDraft } from '@/services/validation';
import type {
  Category,
  NeedWant,
  PaymentMethod,
  SavingDirection,
  SavingsGoal,
  TransactionType,
} from '@/types/models';
import { addDays, formatDateWithWeekday, isValidIsoDate, todayIso } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits, parseAmountToMinorUnits } from '@/utils/money';

/**
 * The "add / edit transaction" form, presented as a modal screen.
 *
 * The screen owns no rules: it collects a `TransactionDraft` and hands it to
 * `saveTransaction`, which validates against the database and returns either
 * field-level messages or the stored row. The one piece of logic here is the
 * *dependency* the milestone calls for — the category list is filtered by the
 * chosen type, so income, expense and saving each offer only their own
 * categories. The service enforces that rule too; this only makes it visible.
 */
export default function TransactionFormScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    savingsGoalId?: string;
    savingDirection?: string;
  }>();
  const editingId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
  const isEditing = editingId !== null;

  /**
   * Set when the form is opened from a savings goal ("Add money" / "Withdraw").
   * Those three decisions are already made, so the form can start part-filled.
   */
  const requestedGoalId =
    typeof params.savingsGoalId === 'string' && params.savingsGoalId.length > 0
      ? params.savingsGoalId
      : null;
  const requestedDirection: SavingDirection = params.savingDirection === 'out' ? 'out' : 'in';

  const [draft, setDraft] = useState<TransactionDraft>(() => createEmptyDraft(todayIso()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the look-ups the form needs, plus the existing transaction when editing.
  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        // Include retired rows only when editing: an old transaction may use a
        // category that has since been retired, and it must still display.
        const [categoryRows, paymentMethodRows, savingGoalRows, preferred] = await Promise.all([
          listCategories(db, { includeInactive: isEditing }),
          listPaymentMethods(db, { includeInactive: isEditing }),
          // Retired goals only matter when editing a transaction that already
          // points at one; a new transaction may only choose an active goal.
          listSavingsGoals(db, { includeArchived: isEditing }),
          isEditing ? Promise.resolve(null) : getPreferredPaymentMethod(db),
        ]);

        let nextDraft = createEmptyDraft(todayIso());
        nextDraft = { ...nextDraft, paymentMethodId: preferred?.id ?? null };

        if (editingId) {
          const existing = await getTransactionById(db, editingId);
          if (!existing) {
            if (!isCancelled) {
              setLoadError('That transaction no longer exists.');
              setIsLoading(false);
            }
            return;
          }
          nextDraft = transactionToDraft(existing);
        } else if (
          requestedGoalId &&
          savingGoalRows.some((goal) => goal.id === requestedGoalId)
        ) {
          // Arriving from a goal leaves only the amount and the wording to type:
          // the type, direction, goal and starting description are decided.
          const goal = savingGoalRows.find((item) => item.id === requestedGoalId);
          const savingsCategory = categoryRows.find((category) => category.type === 'saving');
          const isWithdrawal = requestedDirection === 'out';

          nextDraft = {
            ...nextDraft,
            type: 'saving',
            categoryId: savingsCategory?.id ?? null,
            savingDirection: requestedDirection,
            savingsGoalId: requestedGoalId,
            description: isWithdrawal
              ? `Withdrawal from ${goal?.name ?? 'savings'}`
              : `Contribution to ${goal?.name ?? 'savings'}`,
          };
        }

        if (isCancelled) {
          return;
        }
        setCategories(categoryRows);
        setPaymentMethods(paymentMethodRows);
        setSavingsGoals(savingGoalRows);
        setDraft(nextDraft);
      } catch (error) {
        if (!isCancelled) {
          setLoadError(getErrorMessage(error));
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
  }, [db, editingId, isEditing, requestedDirection, requestedGoalId]);

  const typeOptions: readonly SegmentOption<TransactionType>[] = useMemo(
    () => [
      { value: 'income', label: 'Income', icon: 'trending-up-outline', color: theme.income },
      { value: 'expense', label: 'Expense', icon: 'trending-down-outline', color: theme.expense },
      { value: 'saving', label: 'Saving', icon: 'wallet-outline', color: theme.savings },
    ],
    [theme]
  );

  const needWantOptions: readonly SegmentOption<NeedWant>[] = useMemo(
    () => [
      { value: 'need', label: 'Need' },
      { value: 'want', label: 'Want' },
      { value: 'unexpected', label: 'Unexpected' },
    ],
    []
  );

  const savingDirectionOptions: readonly SegmentOption<SavingDirection>[] = useMemo(
    () => [
      { value: 'in', label: 'Into savings', icon: 'arrow-down-outline', color: theme.savings },
      { value: 'out', label: 'Out of savings', icon: 'arrow-up-outline', color: theme.savings },
    ],
    [theme]
  );

  // The dependent list: only categories that belong to the chosen type.
  const categoryOptions = useMemo(
    () =>
      draft.type === null
        ? []
        : categories
            .filter((category) => category.type === draft.type)
            .map((category) => ({
              value: category.id,
              label: category.name,
              icon: category.icon as IoniconName | null,
            })),
    [categories, draft.type]
  );

  const paymentMethodOptions = useMemo(
    () => paymentMethods.map((method) => ({ value: method.id, label: method.name })),
    [paymentMethods]
  );

  const savingsGoalOptions = useMemo(
    () => savingsGoals.map((goal) => ({ value: goal.id, label: goal.name })),
    [savingsGoals]
  );

  const parsedAmount = parseAmountToMinorUnits(draft.amount);
  const amountHint =
    parsedAmount !== null && parsedAmount > 0
      ? `= ${formatMinorUnits(parsedAmount)}`
      : 'For example 1250.50';

  const dateHint = isValidIsoDate(draft.date)
    ? formatDateWithWeekday(draft.date)
    : 'Use the format YYYY-MM-DD';

  /** Applies a change and clears any error on the fields it touches. */
  function updateDraft(patch: Partial<TransactionDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(patch) as (keyof TransactionDraft)[]) {
        delete next[key];
      }
      return next;
    });
  }

  /** Switching type can invalidate the chosen category and its extra fields. */
  function handleTypeChange(type: TransactionType) {
    setDraft((previous) => {
      const stillValid =
        previous.categoryId !== null &&
        categories.some(
          (category) => category.id === previous.categoryId && category.type === type
        );

      return {
        ...previous,
        type,
        categoryId: stillValid ? previous.categoryId : null,
        needWant: type === 'expense' ? previous.needWant : null,
        savingDirection: type === 'saving' ? (previous.savingDirection ?? 'in') : null,
        savingsGoalId: type === 'saving' ? previous.savingsGoalId : null,
      };
    });
    setErrors({});
  }

  /** Choosing an expense category pre-fills its suggested Need/Want. */
  function handleCategoryChange(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId) ?? null;
    updateDraft({
      categoryId,
      needWant:
        draft.type === 'expense' ? (category?.defaultNeedWant ?? draft.needWant) : null,
    });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await saveTransaction(db, draft, isEditing && editingId ? { id: editingId } : {});
      if (result.ok) {
        router.back();
        return;
      }
      setErrors(result.errors);
    } catch (error) {
      Alert.alert('Could not save', getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function handleDelete() {
    if (!editingId) {
      return;
    }

    Alert.alert('Delete this transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsDeleting(true);
            try {
              await deleteTransactionSafely(db, editingId);
              router.back();
            } catch (error) {
              Alert.alert('Could not delete', getErrorMessage(error));
              setIsDeleting(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <ThemedText type="heading">{isEditing ? 'Edit transaction' : 'New transaction'}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : null]}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <ThemedText type="default" style={styles.centerText}>
            {loadError}
          </ThemedText>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <SegmentedControl
                label="TYPE"
                options={typeOptions}
                value={draft.type}
                onChange={handleTypeChange}
                error={errors.type}
              />
            </View>

            <View style={styles.section}>
              <TextField
                label="AMOUNT"
                value={draft.amount}
                onChangeText={(amount) => updateDraft({ amount })}
                placeholder="0.00"
                keyboardType="decimal-pad"
                inputMode="decimal"
                error={errors.amount}
                hint={amountHint}
              />
              <TextField
                label="DESCRIPTION"
                value={draft.description}
                onChangeText={(description) => updateDraft({ description })}
                placeholder="Lunch, Matatu to college…"
                error={errors.description}
                maxLength={120}
              />
              <TextField
                label="DATE"
                value={draft.date}
                onChangeText={(date) => updateDraft({ date })}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
                error={errors.date}
                hint={dateHint}
              />
              <View style={styles.chipRow}>
                <DateChip label="Today" date={todayIso()} onSelect={(date) => updateDraft({ date })} />
                <DateChip
                  label="Yesterday"
                  date={addDays(todayIso(), -1)}
                  onSelect={(date) => updateDraft({ date })}
                />
                <DateChip
                  label="2 days ago"
                  date={addDays(todayIso(), -2)}
                  onSelect={(date) => updateDraft({ date })}
                />
              </View>
            </View>

            <View style={styles.section}>
              <SelectField
                label="CATEGORY"
                value={draft.categoryId}
                options={categoryOptions}
                onChange={handleCategoryChange}
                disabled={draft.type === null}
                placeholder={draft.type === null ? 'Choose a type first' : 'Choose a category'}
                emptyMessage="No categories for this type yet."
                error={errors.categoryId}
              />

              {draft.type === 'expense' ? (
                <SegmentedControl
                  label="NEED / WANT"
                  options={needWantOptions}
                  value={draft.needWant}
                  onChange={(needWant) => updateDraft({ needWant })}
                  error={errors.needWant}
                  hint="Used by reports to compare essentials with treats."
                />
              ) : null}

              {draft.type === 'saving' ? (
                <>
                  <SegmentedControl
                    label="DIRECTION"
                    options={savingDirectionOptions}
                    value={draft.savingDirection}
                    onChange={(savingDirection) => updateDraft({ savingDirection })}
                    error={errors.savingDirection}
                  />

                  <SelectField
                    label="SAVINGS GOAL (OPTIONAL)"
                    value={draft.savingsGoalId}
                    options={savingsGoalOptions}
                    onChange={(savingsGoalId) => updateDraft({ savingsGoalId })}
                    placeholder="Not for a particular goal"
                    emptyMessage="No savings goals yet."
                    error={errors.savingsGoalId}
                    hint="A goal is how you track progress towards something specific."
                  />
                </>
              ) : null}
            </View>

            <View style={styles.section}>
              <SelectField
                label="PAYMENT METHOD (OPTIONAL)"
                value={draft.paymentMethodId}
                options={paymentMethodOptions}
                onChange={(paymentMethodId) => updateDraft({ paymentMethodId })}
                placeholder="Not specified"
                emptyMessage="No payment methods yet."
                error={errors.paymentMethodId}
              />
              <TextField
                label="NOTES (OPTIONAL)"
                value={draft.notes ?? ''}
                onChangeText={(notes) => updateDraft({ notes: notes.length > 0 ? notes : null })}
                placeholder="Anything worth remembering later"
                multiline
                maxLength={500}
                error={errors.notes}
              />
            </View>

            <Button
              label={isEditing ? 'Save changes' : 'Save transaction'}
              onPress={handleSave}
              loading={isSaving}
              disabled={isDeleting}
            />
            {isEditing ? (
              <Button
                label="Delete transaction"
                variant="danger"
                onPress={handleDelete}
                loading={isDeleting}
                disabled={isSaving}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}

/** A small tappable shortcut that fills the date field with a common value. */
function DateChip({
  label,
  date,
  onSelect,
}: {
  label: string;
  date: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onSelect(date)}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: theme.border, backgroundColor: theme.background },
        pressed ? styles.pressed : null,
      ]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  section: {
    gap: Spacing.three,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
