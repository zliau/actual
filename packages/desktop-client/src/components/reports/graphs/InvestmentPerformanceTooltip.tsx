import { theme } from '@actual-app/components/theme';
import { css } from '@emotion/css';

import { formatGainRatio } from '#investments';

export type InvestmentPerformanceRow = {
  label: string;
  total: number;
  // Missing for a security not yet bought by then
  securities: Record<string, number | undefined>;
};

export type InvestmentPerformanceSeries = {
  key: string;
  name: string;
  color: string;
  strokeWidth: number;
  value: (row: InvestmentPerformanceRow) => number | undefined;
};

type TooltipProps = {
  active?: boolean;
  label?: string;
  series: InvestmentPerformanceSeries[];
  payload?: Array<{ payload: InvestmentPerformanceRow }>;
};

export function InvestmentPerformanceTooltip({
  active,
  label,
  series,
  payload,
}: TooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0].payload;
  return (
    <div
      className={css({
        zIndex: 1000,
        pointerEvents: 'none',
        borderRadius: 2,
        boxShadow: '0 1px 6px rgba(0, 0, 0, .20)',
        backgroundColor: theme.menuBackground,
        color: theme.menuItemText,
        padding: 10,
      })}
    >
      <div style={{ marginBottom: 5 }}>
        <strong>{label}</strong>
      </div>
      {series.flatMap(({ key, name, color, value }) => {
        const ratio = value(row);
        return ratio == null
          ? []
          : [
              <div
                key={key}
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <span style={{ color, marginRight: 15 }}>{name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatGainRatio(ratio)}
                </span>
              </div>,
            ];
      })}
    </div>
  );
}
