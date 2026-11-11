import * as monthUtils from '@actual-app/core/shared/months';
import type {
  AccountEntity,
  InvestmentPerformance,
  PerformanceMonth,
  TimeFrame,
} from '@actual-app/core/types/models';

import type { InvestmentPerformanceRow } from '#components/reports/graphs/InvestmentPerformanceTooltip';

// The account a performance report shows: the chosen one while it is still an
// open investment account, or else the first that is
export function getPerformanceAccount(
  accounts: AccountEntity[],
  accountId: string | undefined,
): AccountEntity | undefined {
  const investmentAccounts = accounts.filter(
    account => account.investment && !account.closed,
  );
  return (
    investmentAccounts.find(account => account.id === accountId) ??
    investmentAccounts[0]
  );
}

// All months since the first trade, unless the report was set to fewer
export function getDefaultPerformanceTimeFrame(
  performance: InvestmentPerformance | undefined,
): TimeFrame {
  const currentMonth = monthUtils.currentMonth();
  return {
    start: performance?.months[0]?.month ?? currentMonth,
    end: currentMonth,
    mode: 'full',
  };
}

// Each month in the range, with the growth since the range started. When there
// are months before the range, the last of them leads at 0%, so every line
// starts from the range's start.
export function getPerformanceRows(
  performance: InvestmentPerformance,
  start: string,
  end: string,
  locale: Parameters<typeof monthUtils.format>[2],
): InvestmentPerformanceRow[] {
  const baseline = getBaseline(performance, start);
  const toRow = (
    { month, total, securities }: PerformanceMonth,
    getValue: (growth: number, base: number) => number,
  ): InvestmentPerformanceRow => ({
    label: monthUtils.format(month, 'MMM yy', locale),
    total: getValue(total.growth, baseline?.total.growth ?? 1),
    securities: Object.fromEntries(
      Object.entries(securities).map(([id, point]) => [
        id,
        getValue(point.growth, baseline?.securities[id]?.growth ?? 1),
      ]),
    ),
  });
  return [
    ...(baseline ? [toRow(baseline, () => 0)] : []),
    ...performance.months
      .filter(({ month }) => month >= start && month <= end)
      .map(month => toRow(month, (growth, base) => growth / base - 1)),
  ];
}

// The return and gain over the range, or null without trades by its end
export function getPerformanceSummary(
  performance: InvestmentPerformance,
  start: string,
  end: string,
): { ratio: number; gain: number } | null {
  const months = performance.months.filter(
    ({ month }) => month >= start && month <= end,
  );
  const last = months.at(-1);
  if (!last) {
    return null;
  }
  const base = getBaseline(performance, start)?.total.growth ?? 1;
  return {
    ratio: last.total.growth / base - 1,
    gain: months.reduce((sum, { total }) => sum + total.gain, 0),
  };
}

// The month just before the range, when there was a trade by then
function getBaseline(
  performance: InvestmentPerformance,
  start: string,
): PerformanceMonth | undefined {
  return performance.months.filter(({ month }) => month < start).at(-1);
}
