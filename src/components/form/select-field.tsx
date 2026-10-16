import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FieldShell } from '@/components/form/field-shell';
import type { IoniconName } from '@/components/icon-name';
import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** One choice in a select field. */
export type SelectOption = {
  value: string;
  label: string;
  icon?: IoniconName | null;
};

type SelectFieldProps = {
  label: string;
  /** Currently selected value, or `null` when nothing is chosen yet. */
  value: string | null;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  /** Greys the control out; used when a choice depends on an earlier field. */
  disabled?: boolean;
  /** Message shown inside the picker when `options` is empty. */
  emptyMessage?: string;
};

/**
 * A dropdown that opens a bottom-sheet list of options.
 *
 * Categories are supplied to this control *already filtered* by the chosen
 * transaction type; the field itself never decides what belongs to what. That
 * keeps the "category depends on type" rule in one place (the form) rather than
 * duplicated between the control and the screen.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  error,
  hint,
  disabled = false,
  emptyMessage = 'Nothing to choose from yet.',
}: SelectFieldProps) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <FieldShell label={label} error={error} hint={hint}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: isOpen }}
        disabled={disabled}
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.control,
          {
            backgroundColor: theme.background,
            borderColor: error ? theme.expense : theme.border,
          },
          disabled ? styles.disabled : null,
          pressed && !disabled ? styles.pressed : null,
        ]}>
        <View style={styles.controlContent}>
          {selected?.icon ? (
            <Ionicons name={selected.icon} size={18} color={theme.textSecondary} />
          ) : null}
          <ThemedText
            type="default"
            themeColor={selected ? 'text' : 'textMuted'}
            numberOfLines={1}
            style={styles.controlText}>
            {selected ? selected.label : placeholder}
          </ThemedText>
        </View>
        <Ionicons name="chevron-down" size={18} color={theme.textMuted} />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          {/* Swallows taps so pressing inside the sheet does not close it. */}
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            onPress={() => {}}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sheetTitle}>
              {label}
            </ThemedText>

            {options.length === 0 ? (
              <ThemedText type="small" themeColor="textMuted" style={styles.sheetEmpty}>
                {emptyMessage}
              </ThemedText>
            ) : (
              <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
                {options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        isSelected ? { backgroundColor: theme.primaryMuted } : null,
                        pressed ? styles.pressed : null,
                      ]}>
                      <View style={styles.optionContent}>
                        {option.icon ? (
                          <Ionicons
                            name={option.icon}
                            size={18}
                            color={isSelected ? theme.primary : theme.textSecondary}
                          />
                        ) : null}
                        <ThemedText type="default" themeColor={isSelected ? 'primary' : 'text'}>
                          {option.label}
                        </ThemedText>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: BorderWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  controlContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  controlText: {
    flexShrink: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: BorderWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    maxHeight: '70%',
    gap: Spacing.two,
  },
  sheetTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetEmpty: {
    paddingVertical: Spacing.four,
    textAlign: 'center',
  },
  sheetList: {
    flexGrow: 0,
  },
  option: {
    minHeight: 52,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
});
