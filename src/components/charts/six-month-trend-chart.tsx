import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ReportsData } from '@/services/reports';
import { ThemedText } from '@/components/themed-text';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { CartesianChart, Line } from 'victory-native';
import { useCallback, useMemo, useState } from 'react';

type SeriesEntry = ReportsData['series'][number];

/** Space held at each edge so the first and last month label can sit inside. */
const EDGE_PADDING = 24;
/** Width of one month label box, so labels never collide. */
const LABEL_BOX_WIDTH = 52;
const AXIS_AREA_HEIGHT = 34;

interface SixMonthTrendChartProps {
  series: SeriesEntry[];
  /** Shown in the legend so the units are never a mystery. */
  currencySymbol: string;
  height?: number;
}

/**
 * Income and spending for the last six months as two lines on one chart.
 *
 * Victory's tick labels need a bundled Skia font file, which this app does not
 * carry — its text comes from React Native. So the grid is drawn by the chart
 * and the month names are laid out underneath it in normal text, positioned to
 * match the points above. The legend names the two lines, and the exact amounts
 * are still listed in the cards around this one, so nothing here depends on
 * reading a colour or a curve.
 */
export function SixMonthTrendChart({
  series,
  currencySymbol,
  height = 200,
}: SixMonthTrendChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const chartData = useMemo(
    () =>
      series.map((entry) => ({
        month: entry.label,
        income: entry.totals.incomeMinorUnits / 100,
        expenses: entry.totals.expensesNetMinorUnits / 100,
      })),
    [series]
  );

  // Each month sits at its own x position, matching the chart's padding.
  const labelPositions = useMemo(() => {
    if (width === 0 || series.length === 0) return [];
    const span = width - EDGE_PADDING * 2;
    const step = series.length > 1 ? span / (series.length - 1) : 0;

    return series.map((entry, index) => {
      const pointX = EDGE_PADDING + index * step;
      const left = Math.min(
        Math.max(pointX - LABEL_BOX_WIDTH / 2, 0),
        Math.max(width - LABEL_BOX_WIDTH, 0)
      );
      return {
        monthKey: entry.monthKey,
        lines: entry.label.split(' '),
        left,
      };
    });
  }, [series, width]);

  // A screen reader cannot read a canvas, and the chart carries no axis
  // numbers, so it announces what it covers and where the figures are.
  const chartLabel = useMemo(() => {
    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last) {
      return 'Money in and money out by month.';
    }
    return `Money in and money out per month, from ${first.label} to ${last.label}. The exact figures are listed below.`;
  }, [series]);

  return (
    <View onLayout={onLayout}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={chartLabel}
        style={[styles.chartArea, { height }]}>
        <CartesianChart
          data={chartData}
          xKey="month"
          yKeys={['income', 'expenses']}
          axisOptions={{
            lineColor: theme.border,
            labelColor: theme.textSecondary,
            // No x tick marks: the month names are laid out below the chart
            // instead, and free-running tick positions would not sit under them.
            tickCount: { x: 0, y: 3 },
          }}
          padding={{ top: Spacing.two, bottom: 0, left: EDGE_PADDING, right: EDGE_PADDING }}
        >
          {({ points }) => (
            <>
              <Line points={points.income} color={theme.income} strokeWidth={2} />
              <Line points={points.expenses} color={theme.expense} strokeWidth={2} />
            </>
          )}
        </CartesianChart>
      </View>

      <View style={[styles.axisArea, { height: AXIS_AREA_HEIGHT }]}>
        {labelPositions.map((label) => (
          <View key={label.monthKey} style={[styles.monthLabel, { left: label.left }]}>
            {label.lines.map((line) => (
              <ThemedText key={line} type="small" themeColor="textMuted" style={styles.monthText}>
                {line}
              </ThemedText>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.income }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {`Money in (${currencySymbol})`}
          </ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: theme.expense }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {`Money out (${currencySymbol})`}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartArea: {
    width: '100%',
  },
  axisArea: {
    width: '100%',
  },
  monthLabel: {
    position: 'absolute',
    top: 0,
    width: LABEL_BOX_WIDTH,
    alignItems: 'center',
  },
  monthText: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 15,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
