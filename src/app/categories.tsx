import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/form';
import type { IoniconName } from '@/components/icon-name';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { listCategories } from '@/db/repositories/categories';
import { useTheme } from '@/hooks/use-theme';
import type { Category, CategoryType, NeedWant } from '@/types/models';
import { getErrorMessage } from '@/utils/errors';

/**
 * Categories — manage the labels that organise every transaction.
 *
 * Categories are **retired, never deleted**: history points at them, and the
 * schema's `ON DELETE RESTRICT` would refuse the delete anyway. So this screen
 * has no delete button; it has Retire and Restore, both of which simply flip
 * `is_active` through `setCategoryActive`.
 *
 * Retired categories stay visible here (dimmed and labelled) because that is the
 * only place they can be brought back or cleaned up. They are deliberately
 * absent from the "add transaction" picker and from budget setup.
 */

/** The order the sections appear in, and how each type is described. */
const SECTIONS: readonly { type: CategoryType; title: string; detail: string }[] = [
  {
    type: 'expense',
    title: 'Expense categories',
    detail: 'Where your spending goes. These are the categories budgets apply to.',
  },
  {
    type: 'income',
    title: 'Income categories',
    detail: 'Where your money comes from.',
  },
  {
    type: 'saving',
    title: 'Savings categories',
    detail: 'Savings transfers. A goal says what the money is for.',
  },
];

const NEED_WANT_LABEL: Record<NeedWant, string> = {
  need: 'Need',
  want: 'Want',
  unexpected: 'Unexpected',
};

/** One category line. Tapping it opens the edit form. */
function CategoryRow({
  category,
  onPress,
}: {
  category: Category;
  onPress: () => void;
}) {
  const theme = useTheme();

  const detail = category.isActive
    ? category.type === 'expense'
      ? (category.defaultNeedWant ? NEED_WANT_LABEL[category.defaultNeedWant] : 'No need/want suggestion')
      : 'Active'
    : 'Retired — tap to restore';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: category.isActive ? theme.backgroundSelected : theme.background,
            borderColor: theme.border,
          },
        ]}>
        <Ionicons
          name={(category.icon ?? 'pricetag-outline') as IoniconName}
          size={20}
          color={category.isActive ? theme.primary : theme.textMuted}
        />
      </View>

      <View style={styles.rowText}>
        <ThemedText
          type="default"
          numberOfLines={1}
          themeColor={category.isActive ? undefined : 'textMuted'}>
          {category.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

export default function CategoriesScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Retired categories are included: this is the only screen that shows
      // them, and it is where they are restored from.
      const rows = await listCategories(db, { includeInactive: true });
      setCategories(rows);
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setStatus('error');
    } finally {
      setIsRefreshing(false);
    }
  }, [db]);

  // Reload on focus so returning from the edit form shows the saved change.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function openNew() {
    router.push('/category-form');
  }

  function openEdit(id: string) {
    router.push({ pathname: '/category-form', params: { id } });
  }

  let body: ReactNode;

  if (status === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  } else if (status === 'error') {
    body = (
      <EmptyState
        title="Could not load your categories"
        message={error ?? 'Something went wrong.'}
        action={<Button label="Try again" variant="secondary" onPress={() => void load()} />}
      />
    );
  } else if (categories.length === 0) {
    body = (
      <EmptyState
        title="No categories yet"
        message="Add a category for the kind of money movement you want to track."
        action={<Button label="Add a category" onPress={openNew} />}
      />
    );
  } else {
    body = (
      <>
        {SECTIONS.map((section) => {
          const rows = categories.filter((category) => category.type === section.type);
          if (rows.length === 0) {
            return null;
          }

          return (
            <Card key={section.type} title={section.title.toUpperCase()}>
              <ThemedText type="small" themeColor="textMuted">
                {section.detail}
              </ThemedText>
              {rows.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  onPress={() => openEdit(category.id)}
                />
              ))}
            </Card>
          );
        })}

        <ThemedText type="small" themeColor="textMuted">
          Categories are never deleted, because your past transactions point at them. Retiring one
          hides it from the picker while keeping your history readable.
        </ThemedText>

        <Button
          label="Add a category"
          variant="secondary"
          loading={isRefreshing}
          onPress={openNew}
        />
      </>
    );
  }

  return (
    <ScreenScaffold
      title="Categories"
      subtitle="Rename, retire or add the labels used to group your money."
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
});
