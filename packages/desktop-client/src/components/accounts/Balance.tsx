import React, { useRef } from 'react';
import type { RefObject } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgExclamationOutline } from '@actual-app/components/icons/v1';
import { SvgArrowButtonRight1 } from '@actual-app/components/icons/v2';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { q } from '@actual-app/core/shared/query';
import type { Query } from '@actual-app/core/shared/query';
import { getScheduledAmount } from '@actual-app/core/shared/schedules';
import { isPreviewId } from '@actual-app/core/shared/transactions';
import type { AccountEntity } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';
import { useHover } from 'usehooks-ts';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { CellValue, CellValueText } from '#components/spreadsheet/CellValue';
import { exchangeRateQueries } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { useCachedSchedules } from '#hooks/useCachedSchedules';
import { useFormat } from '#hooks/useFormat';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useRatesToMainCurrency } from '#hooks/useRatesToMainCurrency';
import { useSelectedItems } from '#hooks/useSelected';
import { useSheetValue } from '#hooks/useSheetValue';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';
import type { Binding } from '#spreadsheet';
import { sumInMainCurrency } from '#spreadsheet/bindings';

type DetailedBalanceProps = {
  name: string;
  balance: number;
  isExactBalance?: boolean;
  currency?: string;
};

function DetailedBalance({
  name,
  balance,
  isExactBalance = true,
  currency,
}: DetailedBalanceProps) {
  const format = useFormat();
  return (
    <Text
      style={{
        borderRadius: 4,
        padding: '4px 6px',
        color: theme.pillText,
        backgroundColor: theme.pillBackground,
      }}
    >
      {name}{' '}
      <PrivacyFilter>
        <FinancialText style={{ fontWeight: 600 }}>
          {!isExactBalance && '~ '}
          {format(balance, 'financial', currency)}
        </FinancialText>
      </PrivacyFilter>
    </Text>
  );
}

type SelectedBalanceProps = {
  selectedItems: Set<string>;
  account?: AccountEntity;
};

export function SelectedBalance({
  selectedItems,
  account,
}: SelectedBalanceProps) {
  const { t } = useTranslation();
  const mainCurrency = useMainCurrency();
  const currency = getForeignCurrency(account, mainCurrency) ?? undefined;

  const name = `selected-balance-${[...selectedItems].join('-')}`;

  const rows = useSheetValue<'balance', `selected-transactions-${string}`>({
    name: name as `selected-transactions-${string}`,
    query: q('transactions')
      .filter({
        id: { $oneof: [...selectedItems] },
        parent_id: { $oneof: [...selectedItems] },
      })
      .select('id'),
  });
  const ids = new Set((rows || []).map((r: { id: string }) => r.id));

  const finalIds = [...selectedItems].filter(id => !ids.has(id));
  let balance = useSheetValue<'balance', `selected-balance-${string}`>({
    name: (name + '-sum') as `selected-balance-${string}`,
    query: q('transactions')
      .filter({ id: { $oneof: finalIds } })
      .options({ splits: 'all' })
      // Across accounts, add up the amounts converted to the main currency
      .calculate({ $sum: account ? '$amount' : '$main_amount' }),
  });

  let scheduleBalance = 0;

  const { isLoading, schedules = [] } = useCachedSchedules();
  const { data: accounts = [] } = useAccounts();
  const getRate = useRatesToMainCurrency();

  if (isLoading) {
    return null;
  }

  let isExactBalance = true;

  for (const id of [...selectedItems].filter(isPreviewId)) {
    // Preview IDs are in the format `preview/<schedule_id>/<date>`
    const scheduleId = id.slice(8).split('/')[0];
    const schedule = schedules.find(s => s.id === scheduleId);
    if (schedule) {
      // If a schedule is `between X and Y` then we calculate the average
      if (schedule._amountOp === 'isbetween') {
        isExactBalance = false;
      }

      if (!account) {
        // Across accounts, add up the amounts converted to the main currency
        const scheduleCurrency = getForeignCurrency(
          accounts.find(({ id }) => id === schedule._account),
          mainCurrency,
        );
        scheduleBalance += Math.round(
          getScheduledAmount(schedule._amount) *
            getRate(scheduleCurrency, id.slice(8).split('/')[1]),
        );
      } else if (account.id === schedule._account) {
        scheduleBalance += getScheduledAmount(schedule._amount);
      } else {
        scheduleBalance -= getScheduledAmount(schedule._amount);
      }
    }
  }

  if (typeof balance !== 'number' && !scheduleBalance) {
    return null;
  } else {
    balance = (balance ?? 0) + scheduleBalance;
  }

  return (
    <DetailedBalance
      name={t('Selected balance:')}
      balance={balance}
      isExactBalance={isExactBalance}
      currency={currency}
    />
  );
}

type FilteredBalanceProps = {
  filteredAmount?: number | null;
  currency?: string;
};

function FilteredBalance({ filteredAmount, currency }: FilteredBalanceProps) {
  const { t } = useTranslation();

  return (
    <DetailedBalance
      name={t('Filtered balance:')}
      balance={filteredAmount ?? 0}
      isExactBalance
      currency={currency}
    />
  );
}

type MoreBalancesProps = {
  balanceQuery: { name: `balance-query-${string}`; query: Query };
  currency?: string;
};

function MoreBalances({ balanceQuery, currency }: MoreBalancesProps) {
  const { t } = useTranslation();

  const cleared = useSheetValue<'balance', `balance-query-${string}-cleared`>({
    name: (balanceQuery.name + '-cleared') as `balance-query-${string}-cleared`,
    query: balanceQuery.query.filter({ cleared: true }),
  });
  const uncleared = useSheetValue<
    'balance',
    `balance-query-${string}-uncleared`
  >({
    name: (balanceQuery.name +
      '-uncleared') as `balance-query-${string}-uncleared`,
    query: balanceQuery.query.filter({ cleared: false }),
  });

  return (
    <>
      <DetailedBalance
        name={t('Cleared total:')}
        balance={cleared ?? 0}
        currency={currency}
      />
      <DetailedBalance
        name={t('Uncleared total:')}
        balance={uncleared ?? 0}
        currency={currency}
      />
    </>
  );
}

type MainCurrencyBalanceProps = {
  account: AccountEntity;
  mainCurrency: string;
};

// The balance of an account in another currency, valued in the main currency
// at the latest exchange rate
function MainCurrencyBalance({
  account,
  mainCurrency,
}: MainCurrencyBalanceProps) {
  const { t } = useTranslation();

  const dispatch = useDispatch();
  const currency = account.currency ?? '';

  const balance = useSheetValue<'balance', `balance-query-${string}`>({
    name: `balance-query-${account.id}-main-currency`,
    query: q('transactions')
      .filter({ account: account.id })
      .calculate(sumInMainCurrency),
  });
  const { data: rates, isPlaceholderData } = useQuery(
    exchangeRateQueries.list({ currency, mainCurrency }),
  );

  if (isPlaceholderData) {
    return null;
  }

  // Without a rate the balance can't be valued in the main currency
  if (!rates?.length) {
    return (
      <Button
        variant="bare"
        onPress={() =>
          dispatch(
            pushModal({
              modal: {
                name: 'edit-exchange-rate',
                options: { fromCurrency: currency, toCurrency: mainCurrency },
              },
            }),
          )
        }
        style={{
          padding: '4px 6px',
          gap: 4,
          color: theme.warningText,
          backgroundColor: theme.pillBackground,
        }}
      >
        <SvgExclamationOutline style={{ width: 12, height: 12 }} />
        <Trans>
          Add a {{ currency }} to {{ mainCurrency }} rate to see the balance in{' '}
          {{ mainCurrency }}
        </Trans>
      </Button>
    );
  }

  return (
    <DetailedBalance
      name={t('In {{currency}}:', { currency: mainCurrency })}
      balance={balance ?? 0}
    />
  );
}

type BalancesProps = {
  balanceQuery: { name: `balance-query-${string}`; query: Query };
  showExtraBalances: boolean;
  onToggleExtraBalances: () => void;
  account?: AccountEntity;
  isFiltered: boolean;
  filteredAmount?: number | null;
};

export function Balances({
  balanceQuery,
  showExtraBalances,
  onToggleExtraBalances,
  account,
  isFiltered,
  filteredAmount,
}: BalancesProps) {
  const selectedItems = useSelectedItems();
  const mainCurrency = useMainCurrency();
  const currency = getForeignCurrency(account, mainCurrency) ?? undefined;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isButtonHovered = useHover(buttonRef as RefObject<HTMLButtonElement>);

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: -5,
        marginLeft: -5,
        gap: 10,
      }}
    >
      <Button
        ref={buttonRef}
        data-testid="account-balance"
        variant="bare"
        onPress={onToggleExtraBalances}
        style={{
          paddingTop: 1,
          paddingBottom: 1,
        }}
      >
        <CellValue
          binding={
            { ...balanceQuery, value: 0 } as Binding<
              'balance',
              `balance-query-${string}`
            >
          }
          type="financial"
        >
          {props => (
            <CellValueText
              {...props}
              currency={currency}
              style={{
                fontSize: 22,
                fontWeight: 400,
                color:
                  props.value < 0
                    ? theme.numberNegative
                    : props.value > 0
                      ? theme.numberPositive
                      : theme.pageTextSubdued,
              }}
            />
          )}
        </CellValue>

        <SvgArrowButtonRight1
          style={{
            width: 10,
            height: 10,
            marginLeft: 10,
            color: theme.pillText,
            transform: showExtraBalances ? 'rotateZ(180deg)' : 'rotateZ(0)',
            opacity:
              isButtonHovered || selectedItems.size > 0 || showExtraBalances
                ? 1
                : 0,
          }}
        />
      </Button>

      {account && currency && mainCurrency && (
        <MainCurrencyBalance account={account} mainCurrency={mainCurrency} />
      )}

      {showExtraBalances && (
        <MoreBalances balanceQuery={balanceQuery} currency={currency} />
      )}

      {selectedItems.size > 0 && (
        <SelectedBalance selectedItems={selectedItems} account={account} />
      )}
      {isFiltered && (
        <FilteredBalance filteredAmount={filteredAmount} currency={currency} />
      )}
    </View>
  );
}
