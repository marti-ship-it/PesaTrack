import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
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

import { Card } from '@/components/card';
import { Button, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  createSavingsGoal,
  getSavingsGoalById,
  listSavingsGoals,
  setSavingsGoalArchived,
  updateSavingsGoal,
} from '@/db/repositories/savings-goals';
import { useTheme } from '@/hooks/use-theme';
import {
  createEmptyGoalDraft,
  goalPatchFromDraft,
  goalTargetDateHint,
  savingsGoalDraftFrom,
  validateSavingsGoalDraft,
  type SavingsGoalDraft,
  type SavingsGoalErrors,
} from '@/services/savings';
import type { SavingsGoal } from '@/types/models';
import { isValidIsoDate } from '@/utils/dates';
import { getErrorMessage } from '@/utils/errors';
import { formatMinorUnits } from '@/utils/money';

/**
 * The "add / edit savings goal" form, presented as a modal over the tabs.
 *
 * Two modes, one screen:
 *
 *   - **Add** (no `id`): name, target, an optional opening balance and an
 *     optional target date.
 *   - **Edit** (`?id=…`): the same fields, plus Archive / Restore.
 *
 * Two deliberate omissions:
 *
 *   1. **No balance field.** What a goal holds is the sum of the saving
 *      transactions linked to it, so it is never typed in and cannot be edited
 *      here. An *opening* balance exists only to cover money saved before
 *      PesaTrack was installed; it is not income and is not a contribution.
 *   2. **No delete.** Deleting would set `savings_goal_id` to null on every
 *      linked transaction, quietly erasing where that money had been going.
 *      Archiving keeps the link.
 */
export default function SavingsGoalFormScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const params = useLocalSearchParams<{ id?: string }>();
  const goalId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
  const isEditing = goalId !== null;

  const [goal, setGoal] = useState<SavingsGoal | null>(null);
  const [allGoals, setAllGoals] = useState<SavingsGoal[]>([]);
  const [draft, setDraft] = useState<SavingsGoalDraft>(() => createEmptyGoalDraft());
  const [errors, setErrors] = useState<SavingsGoalErrors>({});

  const [isLoading, setIsLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingArchive, setIsTogglingArchive] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        // Every goal is loaded because the name check needs to know about the
        // others, and archived ones still count as taken names in the user's
        // mind even though they are hidden.
        const goals = await listSavingsGoals(db, { includeArchived: true });
        if (isCancelled) {
          return;
        }
        setAllGoals(goals);

        if (goalId) {
          const existing = await getSavingsGoalById(db, goalId);
          if (isCancelled) {
            return;
          }
          if (!existing) {
            setLoadError('That savings goal no longer exists.');
            return;
          }
          setGoal(existing);
          setDraft(savingsGoalDraftFrom(existing));
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
  }, [db, goalId]);

  function updateDraftField<Key extends keyof SavingsGoalDraft>(
    key: Key,
    value: SavingsGoalDraft[Key]
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  async function handleSave() {
    const validation = validateSavingsGoalDraft(draft, {
      existingGoals: allGoals,
      currentGoalId: goalId,
    });

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    const patch = goalPatchFromDraft(draft, { existingGoals: allGoals, currentGoalId: goalId });
    if (!patch) {
      // Unreachable unless the two functions above disagree, which they cannot:
      // `goalPatchFromDraft` re-runs the same validation.
      return;
    }

    setIsSaving(true);
    try {
      if (goal) {
        await updateSavingsGoal(db, goal.id, patch);
      } else {
        await createSavingsGoal(db, patch);
      }
      router.back();
    } catch (error) {
      Alert.alert('Could not save the goal', getErrorMessage(error));
      setIsSaving(false);
    }
  }

  function handleToggleArchive() {
    if (!goal) {
      return;
    }

    const nextArchived = !goal.isArchived;
    Alert.alert(
      nextArchived ? 'Archive goal' : 'Restore goal',
      nextArchived
        ? `"${goal.name}" will be hidden from your goal list and from the transaction form. The transactions that built it are kept.`
        : `"${goal.name}" will appear in your goal list again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextArchived ? 'Archive' : 'Restore',
          style: nextArchived ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setIsTogglingArchive(true);
              try {
                await setSavingsGoalArchived(db, goal.id, nextArchived);
                router.back();
              } catch (error) {
                Alert.alert(
                  nextArchived ? 'Could not archive' : 'Could not restore',
                  getErrorMessage(error)
                );
                setIsTogglingArchive(false);
              }
            })();
          },
        },
      ]
    );
  }

  const targetDateHint = isValidIsoDate(draft.targetDate)
    ? goalTargetDateHint(draft.targetDate)
    : null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText type="heading">{isEditing ? 'Edit goal' : 'New goal'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isEditing ? 'Change the target, or archive the goal.' : 'What are you saving for?'}
          </ThemedText>
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
              <TextField
                label="NAME"
                value={draft.name}
                onChangeText={(name) => updateDraftField('name', name)}
                placeholder="For example Emergency fund"
                autoCapitalize="sentences"
                maxLength={60}
                error={errors.name}
              />

              <TextField
                label="TARGET AMOUNT"
                value={draft.targetAmount}
                onChangeText={(targetAmount) => updateDraftField('targetAmount', targetAmount)}
                placeholder="For example 50000"
                keyboardType="decimal-pad"
                hint="The amount you are saving towards."
                error={errors.targetAmount}
              />

              <TextField
                label="ALREADY SAVED (OPTIONAL)"
                value={draft.openingBalance}
                onChangeText={(openingBalance) => updateDraftField('openingBalance', openingBalance)}
                placeholder="For example 2000"
                keyboardType="decimal-pad"
                hint="Money already set aside before you started using PesaTrack. It is not counted as income."
                error={errors.openingBalance}
              />

              <TextField
                label="TARGET DATE (OPTIONAL)"
                value={draft.targetDate}
                onChangeText={(targetDate) => updateDraftField('targetDate', targetDate)}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                maxLength={10}
                hint={targetDateHint ?? 'When you would like to reach the target, if at all.'}
                error={errors.targetDate}
              />
            </View>

            <Button
              label={isEditing ? 'Save changes' : 'Create goal'}
              onPress={handleSave}
              loading={isSaving}
              disabled={isTogglingArchive}
            />

            {goal ? (
              <View style={styles.section}>
                <Card>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    HOW THIS GOAL IS FILLED
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    {`Every "saving" transaction you link to this goal adds to it — you never type a balance here. The target is ${formatMinorUnits(
                      goal.targetMinorUnits,
                      { symbol: 'KSh' }
                    )} today.`}
                  </ThemedText>
                </Card>

                <Button
                  label={goal.isArchived ? 'Restore goal' : 'Archive goal'}
                  variant={goal.isArchived ? 'secondary' : 'danger'}
                  onPress={handleToggleArchive}
                  loading={isTogglingArchive}
                  disabled={isSaving}
                />
                <ThemedText type="small" themeColor="textMuted">
                  {goal.isArchived
                    ? 'This goal is archived. Its money and history are kept.'
                    : 'Archiving keeps every transaction that built this goal.'}
                </ThemedText>
              </View>
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
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  section: {
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
});
