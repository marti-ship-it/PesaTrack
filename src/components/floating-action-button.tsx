import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FloatingActionButtonProps = {
  onPress: () => void;
  /** Accessibility label; the button has no visible text. */
  label: string;
  icon?: 'add' | 'pencil';
};

/**
 * The round "add" button that floats above a list.
 *
 * It sits in the screen's bottom-right corner, clear of the tab bar, so the
 * primary action is always one tap away without scrolling to it.
 */
export function FloatingActionButton({ onPress, label, icon = 'add' }: FloatingActionButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.primary },
        pressed ? styles.pressed : null,
      ]}>
      <Ionicons name={icon} size={28} color={theme.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pressed: {
    opacity: 0.85,
  },
});
