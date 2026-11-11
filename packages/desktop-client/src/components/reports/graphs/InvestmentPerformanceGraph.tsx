import { Trans } from 'react-i18next';

import type { CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import type { InvestmentPerformance } from '@actual-app/core/types/models';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  getColorScale,
  useRechartsAnimation,
} from '#components/reports/chart-theme';
import { Container } from '#components/reports/Container';
import { formatGainRatio } from '#investments';

import { InvestmentPerformanceTooltip } from './InvestmentPerformanceTooltip';
import type {
  InvestmentPerformanceRow,
  InvestmentPerformanceSeries,
} from './InvestmentPerformanceTooltip';

type InvestmentPerformanceGraphProps = {
  style?: CSSProperties;
  data: InvestmentPerformanceRow[];
  securities: InvestmentPerformance['securities'];
  totalName: string;
  compact?: boolean;
  showTooltip?: boolean;
};

export function InvestmentPerformanceGraph({
  style,
  data,
  securities,
  totalName,
  compact = false,
  showTooltip = true,
}: InvestmentPerformanceGraphProps) {
  const animationProps = useRechartsAnimation();
  const colors = getColorScale('qualitative');

  // The total is drawn last so it sits on top. With one security, it would
  // only repeat that security's line.
  const series: InvestmentPerformanceSeries[] = [
    ...(securities.length > 1 && !compact
      ? securities.map((security, index) => ({
          key: security.id,
          name: security.symbol,
          color: colors[index % colors.length],
          strokeWidth: 1.5,
          value: (row: InvestmentPerformanceRow) => row.securities[security.id],
        }))
      : []),
    {
      key: 'total',
      name: totalName,
      color: theme.pageText,
      strokeWidth: 2.5,
      value: (row: InvestmentPerformanceRow) => row.total,
    },
  ];

  return (
    <Container style={{ ...style, ...(compact && { height: 'auto' }) }}>
      {(width, height) =>
        data.length > 0 ? (
          <div>
            {!compact && <div style={{ marginTop: '15px' }} />}
            <LineChart
              width={width}
              height={height}
              data={data}
              margin={{
                top: 10,
                right: 10,
                left: compact ? 0 : 10,
                bottom: 10,
              }}
            >
              {!compact && (
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
              )}
              {!compact && (
                <XAxis
                  dataKey="label"
                  tick={{ fill: theme.reportsLabel, fontSize: 12 }}
                  tickLine={{ stroke: theme.reportsLabel }}
                />
              )}
              <YAxis
                hide={compact}
                tickFormatter={value => formatGainRatio(value)}
                tick={{ fill: theme.reportsLabel, fontSize: 12 }}
                tickLine={{ stroke: theme.reportsLabel }}
                width={compact ? 0 : 60}
              />
              <ReferenceLine y={0} stroke={theme.reportsLabel} />
              {showTooltip && (
                <Tooltip
                  content={
                    <InvestmentPerformanceTooltip
                      series={[...series].reverse()}
                    />
                  }
                  isAnimationActive={false}
                />
              )}
              {!compact && series.length > 1 && (
                <Legend
                  wrapperStyle={{ color: theme.reportsLabel, fontSize: 12 }}
                />
              )}
              {series.map(({ key, name, color, strokeWidth, value }) => (
                <Line
                  key={key}
                  name={name}
                  type="monotone"
                  dataKey={value}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  dot={!compact && data.length <= 24}
                  connectNulls={false}
                  {...animationProps}
                />
              ))}
            </LineChart>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.pageTextSubdued,
            }}
          >
            <Trans>No trades in this period</Trans>
          </div>
        )
      }
    </Container>
  );
}
