import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { FieldShell } from '@/components/form/field-shell';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** One choice in a segmented control. */
export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Optional accent colour (for example the income/expense/savings token). */
  color?: string;
  icon?: IoniconName;
};

type SegmentedControlProps<T extends string> = {
  /** Optional caption; omit for an inline group of choices. */
  label?: string;
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  hint?: string;
};

/**
 * A row of mutually exclusive choices (Income / Expense / Saving, Need / Want, …).
 *
 * Used instead of a dropdown whenever the choices are few and fixed, because the
 * options are then visible without an extra tap. The selected option is marked by
 * colour *and* a filled icon style, so the choice is still clear without colour.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  const row = (
    <View style={styles.row}>
      {options.map((option) => {
        const isSelected = option.value === value;
        const accent = option.color ?? theme.primary;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                borderColor: isSelected ? accent : theme.border,
                backgroundColor: isSelected ? theme.backgroundSelected : theme.background,
              },
              pressed ? styles.pressed : null,
            ]}>
            {option.icon ? (
              <Ionicons name={option.icon} size={16} color={isSelected ? accent : theme.textSecondary} />
            ) : null}
            <ThemedText
              type="small"
              numberOfLines={2}
              style={[styles.segmentLabel, { color: isSelected ? accent : theme.textSecondary }]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  if (!label) {
    return row;
  }

  return (
    <FieldShell label={label} error={error} hint={hint}>
      {row}
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: BorderWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  segmentLabel: {
    textAlign: 'center',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
