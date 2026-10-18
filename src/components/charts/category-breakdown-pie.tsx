import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ReportsData } from '@/services/reports';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pie, PolarChart } from 'victory-native';

type BreakdownRow = ReportsData['breakdown'][number];

/**
 * The colours handed to spending categories, in order of size. Drawn from the
 * theme so the chart follows light and dark mode like everything else, and kept
 * short enough that no two neighbours look alike.
 */
const PALETTE: ThemeColor[] = ['primary', 'savings', 'income', 'warning', 'expense', 'textSecondary'];

/** Colour of a category the pie groups into "Other", and of any refund row. */
const MUTED_COLOR: ThemeColor = 'textMuted';

/** How many categories the pie draws separately before grouping the rest. */
export const BREAKDOWN_SLICE_LIMIT = PALETTE.length;

interface CategoryBreakdownPieProps {
  breakdown: BreakdownRow[];
  height?: number;
}

type PieSliceDatum = {
  label: string;
  value: number;
  color: string;
};

/**
 * The colour of one row of "Where the money went" — the very colour the pie
 * gives that category, or the muted one when the pie folds it into "Other".
 *
 * The list doubles as the chart's legend, so both sides go through this one
 * function rather than each remembering its own ordering.
 */
export function breakdownSwatchColor(
  theme: ReturnType<typeof useTheme>,
  breakdown: readonly BreakdownRow[],
  index: number
): string {
  const row = breakdown[index];
  if (!row || row.netMinorUnits <= 0) {
    return theme[MUTED_COLOR];
  }

  let sliceIndex = 0;
  for (let i = 0; i < index; i += 1) {
    if (breakdown[i].netMinorUnits > 0) {
      sliceIndex += 1;
    }
  }

  return sliceIndex < BREAKDOWN_SLICE_LIMIT ? theme[PALETTE[sliceIndex]] : theme[MUTED_COLOR];
}

/**
 * Spending for the period as a donut: the largest categories drawn separately
 * and anything smaller grouped into "Other".
 *
 * The category list underneath carries every name, amount and percentage, and
 * each of its rows wears the matching colour, so the chart is a summary of
 * numbers already on screen rather than a new thing to decode.
 */
export function CategoryBreakdownPie({ breakdown, height = 176 }: CategoryBreakdownPieProps) {
  const theme = useTheme();

  const slices = useMemo<PieSliceDatum[]>(() => {
    const spending = breakdown.filter((row) => row.netMinorUnits > 0);
    const rest = spending.slice(BREAKDOWN_SLICE_LIMIT);
    const restTotal = rest.reduce((sum, row) => sum + row.netMinorUnits, 0);

    const rows: PieSliceDatum[] = spending
      .slice(0, BREAKDOWN_SLICE_LIMIT)
      .map((row, index) => ({
        label: row.name,
        value: row.netMinorUnits / 100,
        color: theme[PALETTE[index]],
      }));

    if (restTotal > 0) {
      rows.push({ label: 'Other', value: restTotal / 100, color: theme[MUTED_COLOR] });
    }

    return rows;
  }, [breakdown, theme]);

  const totalValue = slices.reduce((sum, slice) => sum + slice.value, 0);
  const accessibilityLabel = useMemo(
    () =>
      slices
        .map((slice) => {
          const share = totalValue > 0 ? Math.round((slice.value / totalValue) * 100) : 0;
          return `${slice.label}: ${share}%`;
        })
        .join(', '),
    [slices, totalValue]
  );

  if (slices.length === 0) {
    return null;
  }

  return (
    <View
      style={[styles.container, { height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Spending by category. ${accessibilityLabel}`}>
      <PolarChart data={slices} colorKey="color" labelKey="label" valueKey="value">
        <Pie.Chart innerRadius="62%" />
      </PolarChart>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: Spacing.two,
  },
});
