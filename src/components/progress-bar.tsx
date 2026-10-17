import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ProgressBarProps = {
  /** Fraction filled, `0`..`1`. Values outside the range are clamped. */
  progress: number;
  /** Fill colour, normally the row's status colour. */
  color: string;
  /** Bar thickness. Defaults to a slim track that fits inside a list row. */
  height?: number;
};

/**
 * A horizontal track that fills left-to-right.
 *
 * One component serves every "how far along is this" question — a budget being
 * spent down towards its limit, or a savings goal being filled up towards its
 * target — so the two look and behave identically.
 *
 * The track colour comes from the theme's `backgroundSelected` token, a real
 * token in `constants/theme.ts`. The fill takes the caller's colour, and the
 * value is clamped so a percentage over 100 (overspent, or goal exceeded)
 * cannot push the fill outside the track.
 */
export function ProgressBar({ progress, color, height = 8 }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { backgroundColor: theme.backgroundSelected, height }]}>
      <View style={[styles.fill, { backgroundColor: color, width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});
