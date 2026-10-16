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

import { Button, SelectField, TextField } from '@/components/form';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { deleteBudget, listBudgetsForMonth, upsertBudget } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import { getSettings } from '@/db/repositories/settings';
import { useTheme } from '@/hooks/use-theme';
import { budgetAmountError } from '@/services/budgets';
import type { Category, MonthlyBudget } from '@/types/models';
import {
  formatMonthLabel,
  isValidMonthKey,
  periodMonthKey,
  todayIso,
  type MonthKey,
} from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { minorUnitsToInputString, parseAmountToMinorUnits } from '@/utils/money';

/**
 * The "set / edit budget" form, presented as a modal over the tabs.
 *
 * It is opened two ways, and both are the same screen:
 *
 *   - from a tap on a category (the param `categoryId` is set, so the category
 *     is fixed and shown as a label);
 *   - from the "Add budget" button (no `categoryId`, so the user picks an
 *     expense category from a list).
 *
 * The screen owns no money rules. It collects an amount string, asks
 * `budgetAmountError` whether it is usable, and hands the value to the
 * repository. The `monthKey` param is what the Budgets screen was showing, so a
 * budget is always written against the month the user was looking at.
 */

type FormErrors = {
  categoryId?: string;
  amount?: string;
};

export default function BudgetFormScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const params = useLocalSearchParams<{ monthKey?: string; categoryId?: string }>();
  const paramCategoryId =
    typeof params.categoryId === 'string' && params.categoryId.length > 0
      ? params.categoryId
      : null;
  const paramMonthKey =
    typeof params.monthKey === 'string' && isValidMonthKey(params.monthKey)
      ? params.monthKey
      : null;

  const [monthKey, setMonthKey] = useState<MonthKey | null>(null);
  const [currencySymbol, setCurrencySymbol] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<MonthlyBudget[]>([]);

  const [categoryId, setCategoryId] = useState<string | null>(paramCategoryId);
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const settings = await getSettings(db);
        const resolvedMonthKey =
          paramMonthKey ?? periodMonthKey(todayIso(), settings.financialMonthStartDay);

        // Expense categories only: a budget is meaningless for income or a
        // savings pot. Retired categories are included so an existing budget on
        // one can still be seen and cleared.
        const [categoryRows, budgetRows] = await Promise.all([
          listCategories(db, { type: 'expense', includeInactive: true }),
          listBudgetsForMonth(db, resolvedMonthKey),
        ]);

        if (isCancelled) {
          return;
        }

        setMonthKey(resolvedMonthKey);
        setCurrencySymbol(settings.currencySymbol);
        setCategories(categoryRows);
        setBudgets(budgetRows);

        if (paramCategoryId) {
          const category = categoryRows.find((item) => item.id === paramCategoryId);
          if (!category) {
            setLoadError('That category is not available for a budget.');
            return;
          }
          const existing = budgetRows.find((budget) => budget.categoryId === paramCategoryId);
          setCategoryId(paramCategoryId);
          setAmount(existing ? minorUnitsToInputString(existing.budgetedMinorUnits) : '');
        }
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
  }, [db, paramCategoryId, paramMonthKey]);

  const categoryOptions = useMemo(
    () =>
      categories.map((category) => ({
        value: category.id,
        label: category.name,
        icon: category.icon as IoniconName | null,
      })),
    [categories]
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) ?? null,
    [categories, categoryId]
  );

  const existingBudget = useMemo(
    () => budgets.find((budget) => budget.categoryId === categoryId) ?? null,
    [budgets, categoryId]
  );

  const parsedAmount = parseAmountToMinorUnits(amount);
  const amountHint =
    parsedAmount !== null && parsedAmount > 0
      ? `Cap of ${currencySymbol} ${minorUnitsToInputString(parsedAmount)}`
      : 'For example 5000';

  /** Choosing a category pre-fills an existing budget for that category. */
  function handleCategoryChange(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    const existing = budgets.find((budget) => budget.categoryId === nextCategoryId);
    setAmount(existing ? minorUnitsToInputString(existing.budgetedMinorUnits) : '');
    setErrors({});
  }

  async function handleSave() {
    const nextErrors: FormErrors = {};
    if (categoryId === null) {
      nextErrors.categoryId = 'Choose a category.';
    }
    const amountError = budgetAmountError(amount);
    if (amountError) {
      nextErrors.amount = amountError;
    }

    if (Object.keys(nextErrors).length > 0 || categoryId === null || monthKey === null) {
      setErrors(nextErrors);
      return;
    }

    const budgetedMinorUnits = parseAmountToMinorUnits(amount);
    if (budgetedMinorUnits === null) {
      setErrors({ amount: 'Enter a valid amount, for example 5000.' });
      return;
    }

    setIsSaving(true);
    try {
      await upsertBudget(db, { monthKey, categoryId, budgetedMinorUnits });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', getErrorMessage(error));
      setIsSaving(false);
    }
  }

  function handleClear() {
    if (!existingBudget || categoryId === null || monthKey === null) {
      return;
    }

    Alert.alert('Clear this budget?', 'The category will go back to "No budget set".', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsDeleting(true);
            try {
              await deleteBudget(db, monthKey, categoryId);
              router.back();
            } catch (error) {
              Alert.alert('Could not clear', getErrorMessage(error));
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
        <View style={styles.headerText}>
          <ThemedText type="heading">{existingBudget ? 'Edit budget' : 'Set budget'}</ThemedText>
          {monthKey ? (
            <ThemedText type="small" themeColor="textSecondary">
              {formatMonthLabel(monthKey)}
            </ThemedText>
          ) : null}
        </View>
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
              {paramCategoryId ? (
                <TextField
                  label="CATEGORY"
                  value={selectedCategory?.name ?? ''}
                  onChangeText={() => {}}
                  editable={false}
                  error={errors.categoryId}
                  hint="Budgets apply to expense categories only."
                />
              ) : (
                <SelectField
                  label="CATEGORY"
                  value={categoryId}
                  options={categoryOptions}
                  onChange={handleCategoryChange}
                  placeholder="Choose an expense category"
                  emptyMessage="No expense categories yet."
                  error={errors.categoryId}
                />
              )}

              <TextField
                label="MONTHLY LIMIT"
                value={amount}
                onChangeText={(next) => {
                  setAmount(next);
                  setErrors((previous) => ({ ...previous, amount: undefined }));
                }}
                placeholder="0.00"
                keyboardType="decimal-pad"
                inputMode="decimal"
                error={errors.amount}
                hint={amountHint}
              />

              <ThemedText type="small" themeColor="textMuted">
                Spending is measured against this limit from your saved transactions. Refunds
                reduce the spending they reverse; savings and income are never counted.
              </ThemedText>
            </View>

            <Button
              label={existingBudget ? 'Save changes' : 'Set budget'}
              onPress={handleSave}
              loading={isSaving}
              disabled={isDeleting}
            />
            {existingBudget ? (
              <Button
                label="Clear budget"
                variant="danger"
                onPress={handleClear}
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
  headerText: {
    flexShrink: 1,
    gap: Spacing.half,
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
});
