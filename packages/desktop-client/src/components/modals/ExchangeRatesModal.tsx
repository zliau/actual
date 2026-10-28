import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { useQuery } from '@tanstack/react-query';
import { format as formatDate, parseISO } from 'date-fns';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import {
  exchangeRateQueries,
  formatExchangeRate,
  useUpdateExchangeRatesMutation,
} from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { useDateFormat } from '#hooks/useDateFormat';
import { useMainCurrency } from '#hooks/useMainCurrency';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

// Rates are daily, so the list can be long; show it a page at a time
const PAGE_SIZE = 100;

type ExchangeRatesModalProps = {
  currency?: string;
};

export function ExchangeRatesModal({
  currency: initialCurrency,
}: ExchangeRatesModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const mainCurrency = useMainCurrency();
  const isOnline = useSyncServerStatus() === 'online';
  const { data: accounts = [] } = useAccounts();

  const currencies = [
    ...new Set(
      accounts
        .map(account => account.currency)
        .filter(
          (currency): currency is string =>
            currency != null && currency !== mainCurrency,
        ),
    ),
  ].sort();
  if (initialCurrency && !currencies.includes(initialCurrency)) {
    currencies.unshift(initialCurrency);
  }

  const [currency, setCurrency] = useState(initialCurrency ?? currencies[0]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { data: rates = [], isPending } = useQuery({
    ...exchangeRateQueries.list({
      currency: currency ?? '',
      mainCurrency: mainCurrency ?? '',
    }),
    enabled: currency != null && mainCurrency != null,
  });

  const updateRates = useUpdateExchangeRatesMutation();
  const updateResult = updateRates.data;

  const onEdit = (exchangeRate?: (typeof rates)[number]) => {
    if (!currency || !mainCurrency) {
      return;
    }
    dispatch(
      pushModal({
        modal: {
          name: 'edit-exchange-rate',
          options: exchangeRate
            ? {
                fromCurrency: exchangeRate.from_currency,
                toCurrency: exchangeRate.to_currency,
                exchangeRate,
              }
            : { fromCurrency: currency, toCurrency: mainCurrency },
        },
      }),
    );
  };

  return (
    <Modal name="exchange-rates" containerProps={{ style: { width: 520 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Exchange rates')} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {!currency || !mainCurrency ? (
            <Text style={{ color: theme.pageTextLight, lineHeight: 1.5 }}>
              <Trans>
                Exchange rates are needed once an account uses a currency other
                than the main currency of the budget.
              </Trans>
            </Text>
          ) : (
            <View style={{ gap: 15 }}>
              <Text style={{ color: theme.pageTextLight, lineHeight: 1.5 }}>
                <Trans>
                  Each transaction is converted to {{ mainCurrency }} with the
                  rate of its date, or the closest earlier one. Balances use the
                  latest rate.
                </Trans>
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {currencies.length > 1 && (
                  <Select
                    aria-label={t('Currency')}
                    value={currency}
                    onChange={value => {
                      setCurrency(value);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    options={currencies.map(code => [
                      code,
                      t('{{currency}} to {{mainCurrency}}', {
                        currency: code,
                        mainCurrency,
                      }),
                    ])}
                  />
                )}
                <View style={{ flex: 1 }} />
                {isOnline && (
                  <Button
                    isDisabled={updateRates.isPending}
                    onPress={() => updateRates.mutate()}
                  >
                    {updateRates.isPending ? (
                      <AnimatedLoading style={{ width: 16, height: 16 }} />
                    ) : (
                      <Trans>Fetch rates</Trans>
                    )}
                  </Button>
                )}
                <Button variant="primary" onPress={() => onEdit()}>
                  <Trans>Add rate</Trans>
                </Button>
              </View>

              {updateRates.isError && (
                <Text style={{ color: theme.errorText }}>
                  <Trans>
                    The rates could not be fetched. Check your connection to the
                    server and try again.
                  </Trans>
                </Text>
              )}
              {updateResult && 'error' in updateResult && (
                <Text style={{ color: theme.errorText }}>
                  <Trans>
                    The rates could not be fetched. Sign in to the server and
                    try again.
                  </Trans>
                </Text>
              )}
              {updateResult && 'unavailable' in updateResult && (
                <Text style={{ color: theme.pageTextLight }}>
                  {updateResult.unavailable.includes(currency) ? (
                    <Trans>
                      No rates are available for {{ currency }}. Add them by
                      hand instead.
                    </Trans>
                  ) : updateResult.count === 0 ? (
                    <Trans>The rates are up to date.</Trans>
                  ) : (
                    <Trans count={updateResult.count}>
                      Fetched {{ count: updateResult.count }} rates.
                    </Trans>
                  )}
                </Text>
              )}

              <View
                style={{
                  border: `1px solid ${theme.tableBorder}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    padding: '6px 10px',
                    fontSize: 13,
                    color: theme.tableHeaderText,
                    backgroundColor: theme.tableHeaderBackground,
                    borderBottom: `1px solid ${theme.tableBorder}`,
                  }}
                >
                  <Text style={{ flex: 1 }}>
                    <Trans>Date</Trans>
                  </Text>
                  <Text style={{ width: 160, textAlign: 'right' }}>
                    <Trans>
                      1 {{ currency }} in {{ mainCurrency }}
                    </Trans>
                  </Text>
                  <Text style={{ width: 90, textAlign: 'right' }}>
                    <Trans>Source</Trans>
                  </Text>
                </View>
                <View
                  style={{
                    maxHeight: 320,
                    overflowY: 'auto',
                    backgroundColor: theme.tableBackground,
                  }}
                >
                  {rates.length === 0 && !isPending && (
                    <Text
                      style={{
                        padding: '20px 10px',
                        textAlign: 'center',
                        color: theme.pageTextSubdued,
                      }}
                    >
                      <Trans>No rates for {{ currency }} yet.</Trans>
                    </Text>
                  )}
                  {rates.slice(0, visibleCount).map(rate => (
                    <Button
                      key={rate.id}
                      variant="bare"
                      aria-label={t('Edit the rate of {{date}}', {
                        date: formatDate(parseISO(rate.date), dateFormat),
                      })}
                      onPress={() => onEdit(rate)}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-start',
                        padding: '6px 10px',
                        borderRadius: 0,
                        color: theme.tableText,
                        borderBottom: `1px solid ${theme.tableBorder}`,
                      }}
                    >
                      <Text style={{ flex: 1, textAlign: 'left' }}>
                        {formatDate(parseISO(rate.date), dateFormat)}
                      </Text>
                      <Text
                        style={{
                          width: 160,
                          textAlign: 'right',
                          ...styles.tnum,
                        }}
                      >
                        {formatExchangeRate(
                          rate.from_currency === currency
                            ? rate.rate
                            : 1 / rate.rate,
                        )}
                      </Text>
                      <Text
                        style={{
                          width: 90,
                          textAlign: 'right',
                          color: theme.pageTextSubdued,
                        }}
                      >
                        {rate.source === 'manual' ? t('Entered') : t('Fetched')}
                      </Text>
                    </Button>
                  ))}
                  {rates.length > visibleCount && (
                    <Button
                      variant="bare"
                      onPress={() =>
                        setVisibleCount(count => count + PAGE_SIZE)
                      }
                      style={{ padding: 10, borderRadius: 0 }}
                    >
                      <Trans>Show more</Trans>
                    </Button>
                  )}
                </View>
              </View>
            </View>
          )}
        </>
      )}
    </Modal>
  );
}
