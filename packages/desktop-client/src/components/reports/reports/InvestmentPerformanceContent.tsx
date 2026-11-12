import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  InvestmentPerformanceWidget,
  TimeFrame,
} from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { EditablePageHeaderTitle } from '#components/EditablePageHeaderTitle';
import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { MobilePageHeader, Page, PageHeader } from '#components/Page';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { InvestmentPerformanceGraph } from '#components/reports/graphs/InvestmentPerformanceGraph';
import { Header } from '#components/reports/Header';
import { LoadingIndicator } from '#components/reports/LoadingIndicator';
import { calculateTimeRange } from '#components/reports/reportRanges';
import {
  getDefaultPerformanceTimeFrame,
  getPerformanceAccount,
  getPerformanceRows,
  getPerformanceSummary,
} from '#components/reports/spreadsheets/investment-performance';
import { useAccountAmountFormat } from '#hooks/useAccountAmountFormat';
import { useAccounts } from '#hooks/useAccounts';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';
import { formatGainRatio, investmentQueries } from '#investments';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import { useUpdateDashboardWidgetMutation } from '#reports/mutations';

type InvestmentPerformanceContentProps = {
  widget?: InvestmentPerformanceWidget;
};

export function InvestmentPerformanceContent({
  widget,
}: InvestmentPerformanceContentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();
  const updateDashboardWidgetMutation = useUpdateDashboardWidgetMutation();

  const { data: accounts = [], isPending: isLoadingAccounts } = useAccounts();
  const investmentAccounts = accounts.filter(
    account => account.investment && !account.closed,
  );
  const [accountId, setAccountId] = useState(widget?.meta?.account);
  const account = getPerformanceAccount(accounts, accountId);
  const formatAmount = useAccountAmountFormat(account);
  const { data: performance } = useQuery({
    ...investmentQueries.performance({ account: account?.id ?? '' }),
    enabled: !!account,
  });

  // Until the dates are changed, they follow the saved widget or else cover
  // every month since the first trade
  const [chosenTimeFrame, setChosenTimeFrame] = useState<TimeFrame>();
  const [start, end, mode] = calculateTimeRange(
    chosenTimeFrame ?? widget?.meta?.timeFrame,
    getDefaultPerformanceTimeFrame(performance),
  );

  const title = widget?.meta?.name || t('Investment performance');

  async function onSaveWidgetName(newName: string) {
    if (!widget) {
      throw new Error('No widget that could be saved.');
    }
    await updateDashboardWidgetMutation.mutateAsync({
      widget: {
        id: widget.id,
        meta: {
          ...(widget.meta ?? {}),
          name: newName || t('Investment performance'),
        },
      },
    });
  }

  async function onSaveWidget() {
    if (!widget) {
      throw new Error('No widget that could be saved.');
    }
    await updateDashboardWidgetMutation.mutateAsync({
      widget: {
        id: widget.id,
        meta: {
          ...(widget.meta ?? {}),
          account: account?.id,
          timeFrame: { start, end, mode },
        },
      },
    });
    dispatch(
      addNotification({
        notification: {
          type: 'message',
          message: t('Dashboard widget successfully saved.'),
        },
      }),
    );
  }

  const header = isNarrowWidth ? (
    <MobilePageHeader
      title={title}
      leftContent={<MobileBackButton onPress={() => navigate('/reports')} />}
    />
  ) : (
    <PageHeader
      title={
        widget ? (
          <EditablePageHeaderTitle title={title} onSave={onSaveWidgetName} />
        ) : (
          title
        )
      }
    />
  );

  if (!account) {
    return isLoadingAccounts ? (
      <LoadingIndicator />
    ) : (
      <Page header={header} padding={0}>
        <View style={{ padding: 20, color: theme.pageTextSubdued }}>
          <Trans>
            This report shows the gains of investment accounts. Create one to
            see it.
          </Trans>
        </View>
      </Page>
    );
  }

  if (!performance) {
    return <LoadingIndicator />;
  }

  const rows = getPerformanceRows(performance, start, end, locale);
  const summary = getPerformanceSummary(performance, start, end);
  const range = {
    start: monthUtils.format(start, 'MMM yyyy', locale),
    end: monthUtils.format(end, 'MMM yyyy', locale),
  };
  const firstMonth = performance.months[0]?.month ?? monthUtils.currentMonth();
  const allMonths = monthUtils
    .rangeInclusive(firstMonth, monthUtils.currentMonth())
    .map(month => ({
      name: month,
      pretty: monthUtils.format(month, 'MMMM, yyyy', locale),
    }))
    .reverse();

  return (
    <Page header={header} padding={0}>
      <Header
        allMonths={allMonths}
        start={start}
        end={end}
        mode={mode}
        earliestTransaction={monthUtils.firstDayOfMonth(firstMonth)}
        latestTransaction={monthUtils.currentDay()}
        granularities={['month']}
        onChangeDates={(newStart, newEnd, newMode) =>
          setChosenTimeFrame({ start: newStart, end: newEnd, mode: newMode })
        }
        inlineContent={
          investmentAccounts.length > 1 && (
            <Select
              aria-label={t('Account')}
              value={account.id}
              onChange={setAccountId}
              options={investmentAccounts.map(({ id, name }) => [id, name])}
            />
          )
        }
      >
        {widget && (
          <Button variant="primary" onPress={onSaveWidget}>
            <Trans>Save widget</Trans>
          </Button>
        )}
      </Header>

      <View
        style={{
          backgroundColor: theme.tableBackground,
          padding: 20,
          paddingTop: 0,
          flex: '1 0 auto',
          overflowY: 'auto',
        }}
      >
        {summary && (
          <View
            style={{
              alignItems: 'flex-end',
              textAlign: 'right',
              paddingTop: 20,
            }}
          >
            <View
              style={{
                ...styles.largeText,
                ...styles.tnum,
                fontWeight: 400,
                marginBottom: 5,
                color:
                  summary.ratio < 0
                    ? theme.reportsNumberNegative
                    : theme.reportsNumberPositive,
              }}
            >
              {formatGainRatio(summary.ratio)}
            </View>
            <View style={{ ...styles.tnum, color: theme.pageTextSubdued }}>
              <PrivacyFilter>
                {summary.gain < 0
                  ? t('{{amount}} lost from {{start}} to {{end}}', {
                      amount: formatAmount(-summary.gain),
                      ...range,
                    })
                  : t('{{amount}} gained from {{start}} to {{end}}', {
                      amount: formatAmount(summary.gain),
                      ...range,
                    })}
              </PrivacyFilter>
            </View>
          </View>
        )}

        <InvestmentPerformanceGraph
          data={rows}
          securities={performance.securities}
          totalName={account.name}
        />

        <View style={{ marginTop: 30, userSelect: 'none' }}>
          <Paragraph>
            <strong>
              <Trans>How is this worked out?</Trans>
            </strong>
          </Paragraph>
          <Paragraph>
            <Trans>
              Each line shows the return since the start of the dates shown. It
              is time-weighted: the time is split at every buy and sell, and the
              returns of the pieces are multiplied together. So money you put in
              or take out doesn't move the line, only how your shares did. Funds
              report their returns this way, so you can compare yours with
              theirs.
            </Trans>
          </Paragraph>
          <Paragraph>
            <Trans>
              Holdings are valued at each month's last closing price. Fees count
              as losses and dividends as gains. Shares moved in or out count as
              money put in or taken out, and cash in the account isn't included.
              The amount under the percentage is the gain in money, which does
              grow with how much you have invested.
            </Trans>
          </Paragraph>
        </View>
      </View>
    </Page>
  );
}
