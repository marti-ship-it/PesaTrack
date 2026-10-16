import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { FieldShell } from '@/components/form/field-shell';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  hint?: string;
};

/**
 * A labelled single-line or multi-line text input.
 *
 * The border turns red on error so the field is obvious even before the message
 * is read — colour is a reinforcement here, never the only signal, since the
 * message itself is always shown.
 */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  style,
  multiline,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();

  return (
    <FieldShell label={label} error={error} hint={hint}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: theme.background,
            borderColor: error ? theme.expense : theme.border,
            color: theme.text,
          },
          multiline ? styles.multiline : null,
          style,
        ]}
        {...rest}
      />
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: BorderWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
