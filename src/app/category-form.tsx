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

import { Button, SegmentedControl, TextField, type SegmentOption } from '@/components/form';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { DuplicateNameError } from '@/db/errors';
import {
  createCategory,
  getCategoryById,
  setCategoryActive,
  updateCategory,
} from '@/db/repositories/categories';
import { useTheme } from '@/hooks/use-theme';
import type { Category, CategoryType, NeedWant } from '@/types/models';
import { getErrorMessage } from '@/utils/errors';

/**
 * The "add / edit category" form, presented as a modal over the tabs.
 *
 * Two modes, one screen:
 *
 *   - **Add** (no `id` param): the user picks a type, then a name, an optional
 *     icon and — for expenses — a Need/Want suggestion.
 *   - **Edit** (`?id=…`): the type is shown but locked, because transactions
 *     already recorded against this category assume it. Everything else can
 *     change.
 *
 * There is deliberately no delete. Categories are *retired* instead, so
 * historical transactions keep pointing at a real row; the database's
 * `ON DELETE RESTRICT` would refuse a delete anyway. The Retire/Restore button
 * appears only when editing.
 */

/** How each transaction type is described in this form. */
const TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Expense',
  income: 'Income',
  saving: 'Saving',
};

const TYPE_OPTIONS: readonly SegmentOption<CategoryType>[] = [
  { value: 'expense', label: 'Expense', icon: 'arrow-down-circle-outline' },
  { value: 'income', label: 'Income', icon: 'arrow-up-circle-outline' },
  { value: 'saving', label: 'Saving', icon: 'wallet-outline' },
];

/**
 * The Need/Want choice, plus an explicit "Not set".
 *
 * `SegmentedControl` is generic over `T extends string`, so a sentinel value is
 * used for "no suggestion" rather than making the whole field optional — the
 * user can see and change the choice in one place.
 */
type NeedWantChoice = NeedWant | 'unset';

const NEED_WANT_OPTIONS: readonly SegmentOption<NeedWantChoice>[] = [
  { value: 'unset', label: 'Not set' },
  { value: 'need', label: 'Need' },
  { value: 'want', label: 'Want' },
  { value: 'unexpected', label: 'Unexpected' },
];

/**
 * The icons offered in the picker.
 *
 * A curated shortlist rather than the whole Ionicons set: choosing from ~1,300
 * glyphs in a grid on a phone is not a good experience, and a shared set keeps
 * the category list visually consistent.
 */
const ICON_CHOICES: readonly IoniconName[] = [
  'pricetag-outline',
  'cart-outline',
  'fast-food-outline',
  'bus-outline',
  'home-outline',
  'flash-outline',
  'medkit-outline',
  'school-outline',
  'shirt-outline',
  'game-controller-outline',
  'airplane-outline',
  'call-outline',
  'wifi-outline',
  'gift-outline',
  'cash-outline',
  'wallet-outline',
  'card-outline',
  'briefcase-outline',
  'trending-up-outline',
  'book-outline',
  'construct-outline',
  'ellipsis-horizontal',
];

const MAX_NAME_LENGTH = 40;

type FormErrors = {
  name?: string;
  type?: string;
};

export default function CategoryFormScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const params = useLocalSearchParams<{ id?: string; type?: string }>();
  const paramId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
  const paramType: CategoryType =
    params.type === 'income' || params.type === 'saving' ? params.type : 'expense';
  const isEdit = paramId !== null;

  const [category, setCategory] = useState<Category | null>(null);
  const [type, setType] = useState<CategoryType>(paramType);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IoniconName | null>(null);
  const [needWant, setNeedWant] = useState<NeedWantChoice>('unset');
  const [errors, setErrors] = useState<FormErrors>({});

  const [isLoading, setIsLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  useEffect(() => {
    if (!paramId) {
      return;
    }

    let isCancelled = false;

    void (async () => {
      try {
        const stored = await getCategoryById(db, paramId);
        if (isCancelled) {
          return;
        }
        if (!stored) {
          setLoadError('That category no longer exists.');
          return;
        }
        setCategory(stored);
        setType(stored.type);
        setName(stored.name);
        setIcon((stored.icon as IoniconName | null) ?? null);
        setNeedWant(stored.defaultNeedWant ?? 'unset');
      } catch (error) {
        if (!isCancelled) {
          setLoadError(getErrorMessage(error));
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [db, paramId]);

  function handleTypeChange(next: CategoryType) {
    setType(next);
    setErrors((previous) => ({ ...previous, type: undefined }));
    // The Need/Want suggestion only means something for spending, so it is
    // cleared when the user moves away from Expense (and the repository drops
    // it for other types regardless).
    if (next !== 'expense') {
      setNeedWant('unset');
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const nextErrors: FormErrors = {};

    if (trimmedName.length === 0) {
      nextErrors.name = 'Give the category a name.';
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      nextErrors.name = `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // Meaningful for expenses only; the repository ignores it for the others,
    // but sending `null` keeps the intent obvious.
    const defaultNeedWant: NeedWant | null =
      type === 'expense' && needWant !== 'unset' ? needWant : null;

    setIsSaving(true);
    try {
      if (category) {
        await updateCategory(db, category.id, { name: trimmedName, icon, defaultNeedWant });
      } else {
        await createCategory(db, { name: trimmedName, type, icon, defaultNeedWant });
      }
      router.back();
    } catch (error) {
      if (error instanceof DuplicateNameError) {
        // A person-readable message beats the raw "UNIQUE constraint failed".
        setErrors({
          name: `You already have a ${TYPE_LABELS[type].toLowerCase()} category called "${trimmedName}".`,
        });
        setIsSaving(false);
      } else {
        Alert.alert('Could not save', getErrorMessage(error));
        setIsSaving(false);
      }
    }
  }

  function handleToggleActive() {
    if (!category) {
      return;
    }

    const nextIsActive = !category.isActive;

    Alert.alert(
      nextIsActive ? 'Restore category' : 'Retire category',
      nextIsActive
        ? `"${category.name}" will be selectable in the transaction form again.`
        : `"${category.name}" will stop appearing when you add a transaction. Your past transactions keep it, so your history stays readable.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextIsActive ? 'Restore' : 'Retire',
          style: nextIsActive ? 'default' : 'destructive',
          onPress: () => {
            void (async () => {
              setIsTogglingActive(true);
              try {
                await setCategoryActive(db, category.id, nextIsActive);
                router.back();
              } catch (error) {
                Alert.alert(
                  nextIsActive ? 'Could not restore' : 'Could not retire',
                  getErrorMessage(error)
                );
                setIsTogglingActive(false);
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText type="heading">{isEdit ? 'Edit category' : 'New category'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isEdit ? `${TYPE_LABELS[type]} category` : 'Choose what kind of money this groups.'}
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
              {isEdit ? (
                <TextField
                  label="TYPE"
                  value={TYPE_LABELS[type]}
                  onChangeText={() => {}}
                  editable={false}
                  hint="A category's type cannot change, because your recorded transactions depend on it."
                />
              ) : (
                <SegmentedControl
                  label="TYPE"
                  options={TYPE_OPTIONS}
                  value={type}
                  onChange={handleTypeChange}
                  error={errors.type}
                  hint="Expense money leaves, income money arrives, saving moves money into a pot."
                />
              )}

              <TextField
                label="NAME"
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  setErrors((previous) => ({ ...previous, name: undefined }));
                }}
                placeholder={type === 'income' ? 'For example Salary' : 'For example Groceries'}
                autoCapitalize="sentences"
                maxLength={MAX_NAME_LENGTH}
                error={errors.name}
              />

              {type === 'expense' ? (
                <SegmentedControl
                  label="NEED OR WANT"
                  options={NEED_WANT_OPTIONS}
                  value={needWant}
                  onChange={setNeedWant}
                  hint="A suggestion only — you can always override it on a single transaction."
                />
              ) : null}
            </View>

            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                ICON
              </ThemedText>
              <View style={styles.iconGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="No icon"
                  accessibilityState={{ selected: icon === null }}
                  onPress={() => setIcon(null)}
                  style={({ pressed }) => [
                    styles.iconCell,
                    {
                      borderColor: icon === null ? theme.primary : theme.border,
                      backgroundColor:
                        icon === null ? theme.backgroundSelected : theme.backgroundElement,
                    },
                    pressed ? styles.pressed : null,
                  ]}>
                  <Ionicons name="ban-outline" size={20} color={theme.textMuted} />
                </Pressable>

                {ICON_CHOICES.map((choice) => {
                  const isSelected = icon === choice;
                  return (
                    <Pressable
                      key={choice}
                      accessibilityRole="button"
                      accessibilityLabel={choice.replace(/-outline$/, '').replace(/-/g, ' ')}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setIcon(choice)}
                      style={({ pressed }) => [
                        styles.iconCell,
                        {
                          borderColor: isSelected ? theme.primary : theme.border,
                          backgroundColor: isSelected
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                        pressed ? styles.pressed : null,
                      ]}>
                      <Ionicons
                        name={choice}
                        size={20}
                        color={isSelected ? theme.primary : theme.textSecondary}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <ThemedText type="small" themeColor="textMuted">
                The first cell leaves the category without an icon.
              </ThemedText>
            </View>

            <Button
              label={isEdit ? 'Save changes' : 'Add category'}
              onPress={() => void handleSave()}
              loading={isSaving}
              disabled={isTogglingActive}
            />

            {category ? (
              <View style={styles.section}>
                <Button
                  label={category.isActive ? 'Retire category' : 'Restore category'}
                  variant={category.isActive ? 'danger' : 'secondary'}
                  onPress={handleToggleActive}
                  loading={isTogglingActive}
                  disabled={isSaving}
                />
                <ThemedText type="small" themeColor="textMuted">
                  {category.isActive
                    ? 'Retiring hides this category from new transactions but keeps your history intact.'
                    : 'This category is retired. Restore it to use it on new transactions again.'}
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
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
