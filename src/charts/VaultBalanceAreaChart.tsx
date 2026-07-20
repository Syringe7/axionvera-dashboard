import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useChartTheme } from "@/hooks/useChartTheme";
import { gradientId } from "@/visualizations";
import { ChartTooltip } from "@/charts/shared/ChartTooltip";
import { ChartWrapper } from "@/charts/shared/ChartWrapper";
import type { TimeSeriesDataPoint } from "@/types/analytics";

export interface VaultBalanceAreaChartProps {
  /** Balance history data points. */
  data: TimeSeriesDataPoint[];
  /** Height in pixels. */
  height?: number;
  /** Show the average reference line. */
  showAverage?: boolean;
  /** Show grid lines. */
  showGrid?: boolean;
  /** Show tooltip on hover. */
  showTooltip?: boolean;
  /** Custom Y-axis value formatter. */
  yAxisFormatter?: (value: number) => string;
  /** Custom tooltip value formatter. */
  tooltipFormatter?: (value: number) => string;
  /** Custom area color. Falls back to primary theme color. */
  color?: string;
  /** Chart title for accessibility. */
  title?: string;
  /** Accessibility description. */
  description?: string;
  /** Whether data is still loading. */
  isLoading?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Area chart for vault balance history over time.
 *
 * Follows all project chart conventions:
 * - Uses `useChartTheme()` for theme-aware colors
 * - Wraps in `ChartWrapper` for loading/empty/error states
 * - Uses `ChartTooltip` for consistent tooltip styling
 * - Memoized with `React.memo`
 * - Includes `role="img"` + `aria-label` via ChartWrapper
 */
export const VaultBalanceAreaChart = React.memo(function VaultBalanceAreaChart({
  data,
  height = 300,
  showAverage = true,
  showGrid = true,
  showTooltip = true,
  yAxisFormatter = (v) => v.toLocaleString(),
  tooltipFormatter = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  color,
  title = "Vault Balance",
  description = "Vault balance history over time",
  isLoading = false,
  className,
}: VaultBalanceAreaChartProps) {
  const theme = useChartTheme();

  const seriesColor = useMemo(
    () => color || theme.palette[0],
    [color, theme.palette],
  );

  const gid = useMemo(() => gradientId("vault-balance"), []);

  const average = useMemo(() => {
    if (!showAverage || data.length === 0) return null;
    return data.reduce((sum, d) => sum + d.value, 0) / data.length;
  }, [data, showAverage]);

  return (
    <ChartWrapper
      title={title}
      description={description}
      isLoading={isLoading}
      isEmpty={data.length === 0}
      emptyMessage="No balance data available"
      height={height}
      className={className}
    >
      <AreaChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={seriesColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={seriesColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
        )}

        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: theme.axisTickFill }}
          axisLine={{ stroke: theme.axisLineStroke }}
          tickLine={false}
          minTickGap={30}
        />

        <YAxis
          tick={{ fontSize: 12, fill: theme.axisTickFill }}
          axisLine={false}
          tickLine={false}
          tickFormatter={yAxisFormatter}
          width={70}
        />

        {showTooltip && (
          <Tooltip
            content={
              <ChartTooltip
                formatter={(value, name) => [
                  tooltipFormatter(Number(value)),
                  String(name ?? "Balance"),
                ]}
              />
            }
          />
        )}

        {average !== null && (
          <ReferenceLine
            y={average}
            stroke={theme.referenceLineColor}
            strokeDasharray="4 4"
            label={{
              value: `Avg: ${yAxisFormatter(average)}`,
              position: "insideTopRight",
              fill: theme.axisTickFill,
              fontSize: 11,
            }}
          />
        )}

        <Area
          type="monotone"
          dataKey="value"
          name="Balance"
          stroke={seriesColor}
          strokeWidth={2}
          fill={`url(#${gid})`}
          dot={false}
          activeDot={{
            r: 4,
            fill: seriesColor,
            stroke: theme.tooltipBg,
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ChartWrapper>
  );
});
