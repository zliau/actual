import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { InvestmentPerformanceWidget } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { DateRange } from '#components/reports/DateRange';
import { InvestmentPerformanceGraph } from '#components/reports/graphs/InvestmentPerformanceGraph';
import { LoadingIndicator } from '#components/reports/LoadingIndicator';
import { ReportCard } from '#components/reports/ReportCard';
import { ReportCardName } from '#components/reports/ReportCardName';
import { calculateTimeRange } from '#components/reports/reportRanges';
import {
  getDefaultPerformanceTimeFrame,
  getPerformanceAccount,
  getPerformanceRows,
  getPerformanceSummary,
} from '#components/reports/spreadsheets/investment-performance';
import { useAccounts } from '#hooks/useAccounts';
import { useLocale } from '#hooks/useLocale';
import { formatGainRatio, investmentQueries } from '#investments';

type InvestmentPerformanceCardProps = {
  widgetId: string;
  isEditing?: boolean;
  meta?: InvestmentPerformanceWidget['meta'];
  onMetaChange: (newMeta: InvestmentPerformanceWidget['meta']) => void;
};

export function InvestmentPerformanceCard({
  widgetId,
  isEditing,
  meta = {},
  onMetaChange,
}: InvestmentPerformanceCardProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { isNarrowWidth } = useResponsive();
  const [nameMenuOpen, setNameMenuOpen] = useState(false);

  const { data: accounts = [], isPending: isLoadingAccounts } = useAccounts();
  const account = getPerformanceAccount(accounts, meta?.account);
  const { data: performance } = useQuery({
    ...investmentQueries.performance({ account: account?.id ?? '' }),
    enabled: !!account,
  });

  const [start, end] = calculateTimeRange(
    meta?.timeFrame,
    getDefaultPerformanceTimeFrame(performance),
  );
  const rows = performance
    ? getPerformanceRows(performance, start, end, locale)
    : [];
  const summary = performance
    ? getPerformanceSummary(performance, start, end)
    : null;

  return (
    <ReportCard
      widgetId={widgetId}
      isEditing={isEditing}
      disableClick={nameMenuOpen}
      to={`/reports/investment-performance/${widgetId}`}
      onRename={() => setNameMenuOpen(true)}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', padding: 20 }}>
          <View style={{ flex: 1 }}>
            <ReportCardName
              name={meta?.name || t('Investment performance')}
              isEditing={nameMenuOpen}
              onChange={newName => {
                onMetaChange({ ...meta, name: newName });
                setNameMenuOpen(false);
              }}
              onClose={() => setNameMenuOpen(false)}
            />
            {account && <DateRange start={start} end={end} />}
          </View>
          {summary && (
            <View style={{ textAlign: 'right' }}>
              <Block
                style={{
                  ...styles.largeText,
                  ...styles.tnum,
                  fontWeight: 500,
                  marginBottom: 5,
                  color:
                    summary.ratio < 0
                      ? theme.reportsNumberNegative
                      : theme.reportsNumberPositive,
                }}
              >
                {formatGainRatio(summary.ratio)}
              </Block>
              <Block style={{ fontSize: 12, color: theme.pageTextSubdued }}>
                {account?.name}
              </Block>
            </View>
          )}
        </View>

        {!account && !isLoadingAccounts ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.pageTextSubdued,
              padding: 20,
            }}
          >
            <Trans>No open investment accounts</Trans>
          </View>
        ) : performance && account ? (
          <InvestmentPerformanceGraph
            data={rows}
            securities={performance.securities}
            totalName={account.name}
            compact
            showTooltip={!isEditing && !isNarrowWidth}
            style={{ height: 'auto', flex: 1 }}
          />
        ) : (
          <LoadingIndicator />
        )}
      </View>
    </ReportCard>
  );
}
