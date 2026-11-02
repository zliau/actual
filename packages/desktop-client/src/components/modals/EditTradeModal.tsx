import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  getCurrencyExchange,
  getSecurityId,
  getTradeCashAmount,
  isValidSymbol,
  normalizeSymbol,
  sellsMoreThanHeld,
} from '@actual-app/core/shared/investments';
import {
  currentDay,
  isValidYearMonthDay,
} from '@actual-app/core/shared/months';
import {
  amountToInteger,
  currencyToAmount,
} from '@actual-app/core/shared/util';
import type { TradeEntity, TradeType } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { DateSelect } from '#components/select/DateSelect';
import { parseExchangeRate } from '#exchange-rates';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import {
  formatSharePrice,
  formatShares,
  investmentQueries,
  useDeleteTradeMutation,
  useSaveTradeMutation,
} from '#investments';

import { TradeCloseHint } from './TradeCloseHint';
import { TradeNumberField as NumberField } from './TradeNumberField';
import { TradeSymbolSearch } from './TradeSymbolSearch';

type EditTradeModalProps = {
  account: TradeEntity['account'];
  currency: string;
  trade?: TradeEntity;
  symbol?: string;
};

export function EditTradeModal({
  account,
  currency,
  trade,
  symbol: initialSymbol,
}: EditTradeModalProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { data: trades = [] } = useQuery(investmentQueries.trades({ account }));
  const saveTrade = useSaveTradeMutation();
  const deleteTrade = useDeleteTradeMutation();

  const [type, setType] = useState<TradeType>(trade?.type ?? 'buy');
  const [date, setDate] = useState(trade?.date ?? currentDay());
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [name, setName] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState(
    trade ? formatShares(trade.quantity) : '',
  );
  const [priceText, setPriceText] = useState(
    trade ? formatSharePrice(trade.price) : '',
  );
  const [feeText, setFeeText] = useState(
    trade && trade.fee > 0 ? formatSharePrice(trade.fee / 100) : '',
  );
  const [error, setError] = useState<string | null>(null);
  // Looked up once typing in the symbol is done, so each keystroke doesn't use
  // up part of a provider's allowance
  const [lookupSymbol, setLookupSymbol] = useState(initialSymbol ?? '');
  const [isPriceEdited, setIsPriceEdited] = useState(false);

  const exchange = getCurrencyExchange(currency);
  const normalizedLookupSymbol = normalizeSymbol(lookupSymbol);
  const isLookupReady =
    !trade &&
    exchange != null &&
    normalizedLookupSymbol === normalizeSymbol(symbol) &&
    isValidSymbol(normalizedLookupSymbol) &&
    isValidYearMonthDay(date) &&
    date <= currentDay();
  const { data: closeResult, isFetching: isLookingUpClose } = useQuery({
    ...investmentQueries.close({
      exchange: exchange ?? 'US',
      symbol: normalizedLookupSymbol,
      date,
    }),
    enabled: isLookupReady,
  });
  const close =
    isLookupReady && closeResult && 'close' in closeResult ? closeResult : null;
  // The close fills in the price until one is typed in
  const shownPriceText =
    close && !isPriceEdited ? formatSharePrice(close.close) : priceText;

  const quantity = parseExchangeRate(quantityText);
  const price = parseExchangeRate(shownPriceText);
  const feeAmount = feeText.trim() === '' ? 0 : currencyToAmount(feeText);
  const fee =
    feeAmount != null && feeAmount >= 0 ? amountToInteger(feeAmount) : null;

  const normalizedSymbol = normalizeSymbol(symbol);
  const security =
    trade?.security ??
    (exchange ? getSecurityId(exchange, normalizedSymbol) : '');
  const otherTrades = trades.filter(
    other => other.security === security && other.id !== trade?.id,
  );

  const clearError = () => setError(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();

    if (!trade && !isValidSymbol(normalizedSymbol)) {
      setError(t('Enter a symbol, like AAPL.'));
      return;
    }
    if (quantity == null) {
      setError(t('Shares must be more than zero.'));
      return;
    }
    if (price == null) {
      setError(t('Price must be more than zero.'));
      return;
    }
    if (fee == null) {
      setError(t('The fee must be zero or more.'));
      return;
    }

    const fields = { date, type, quantity, price, fee };
    if (sellsMoreThanHeld([...otherTrades, fields])) {
      setError(
        t(
          "You can't sell more {{symbol}} shares than the account holds on that date.",
          { symbol: normalizedSymbol },
        ),
      );
      return;
    }

    if (trade) {
      saveTrade.mutate({ id: trade.id, ...fields });
    } else if (exchange) {
      saveTrade.mutate({
        account,
        symbol: normalizedSymbol,
        exchange,
        name,
        ...fields,
      });
    }
    close();
  };

  const onDelete = (close: () => void) => {
    if (!trade) {
      return;
    }
    if (sellsMoreThanHeld(otherTrades)) {
      setError(
        t(
          'Later sells need these {{symbol}} shares. Change or delete those sells first.',
          { symbol: normalizedSymbol },
        ),
      );
      return;
    }
    deleteTrade.mutate({ id: trade.id });
    close();
  };

  return (
    <Modal name="edit-trade" containerProps={{ style: { width: 400 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={trade ? t('Edit trade') : t('Add trade')}
                shrinkOnOverflow
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Form onSubmit={event => onSubmit(event, () => state.close())}>
            <InlineField label={t('Type')} width="100%">
              <Select
                aria-label={t('Type')}
                value={type}
                onChange={value => {
                  setType(value);
                  clearError();
                }}
                options={[
                  ['buy', t('Buy')],
                  ['sell', t('Sell')],
                ]}
                style={{ flex: 1 }}
              />
            </InlineField>
            <InlineField label={t('Date')} width="100%">
              <View style={{ flex: 1 }}>
                <DateSelect
                  value={date}
                  dateFormat={dateFormat}
                  onSelect={value => {
                    setDate(value);
                    clearError();
                  }}
                  onUpdate={setDate}
                />
              </View>
            </InlineField>
            <InlineField label={t('Symbol')} width="100%">
              <Input
                name="symbol"
                aria-label={t('Symbol')}
                value={symbol}
                // A stored trade keeps its security, so delete it to change this
                disabled={!!trade}
                onChangeValue={value => {
                  setSymbol(value.toUpperCase());
                  setName(null);
                  clearError();
                }}
                onUpdate={setLookupSymbol}
                style={{ flex: 1 }}
              />
            </InlineField>
            {!trade && exchange && (
              <TradeSymbolSearch
                exchange={exchange}
                query={symbol}
                onSelect={result => {
                  setSymbol(result.symbol);
                  setLookupSymbol(result.symbol);
                  setName(result.name);
                  clearError();
                }}
              />
            )}
            <NumberField
              label={t('Shares')}
              name="quantity"
              value={quantityText}
              onChange={value => {
                setQuantityText(value);
                clearError();
              }}
            />
            <NumberField
              label={t('Price')}
              name="price"
              value={shownPriceText}
              suffix={currency}
              onChange={value => {
                setPriceText(value);
                // Clearing the price brings the close back
                setIsPriceEdited(value.trim() !== '');
                clearError();
              }}
            />
            {isLookupReady && (
              <TradeCloseHint
                currency={currency}
                result={closeResult}
                isLoading={isLookingUpClose}
              />
            )}
            <NumberField
              label={t('Fee')}
              name="fee"
              value={feeText}
              suffix={currency}
              onChange={value => {
                setFeeText(value);
                clearError();
              }}
            />

            {error && <FormError style={{ marginTop: 5 }}>{error}</FormError>}

            {quantity != null && price != null && fee != null && (
              <Text style={{ color: theme.pageTextLight, marginTop: 10 }}>
                <Trans>Cash change</Trans>{' '}
                <FinancialText style={{ fontWeight: 600 }}>
                  {format(
                    getTradeCashAmount({ type, quantity, price, fee }),
                    'financial-with-sign',
                    currency,
                  )}
                </FinancialText>
              </Text>
            )}

            <ModalButtons
              leftContent={
                trade && (
                  <Button
                    style={{ color: theme.errorText }}
                    onPress={() => onDelete(() => state.close())}
                  >
                    <Trans>Delete</Trans>
                  </Button>
                )
              }
            >
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                variant="primary"
                style={{ marginLeft: 10 }}
              >
                <Trans>Save</Trans>
              </Button>
            </ModalButtons>
          </Form>
        </>
      )}
    </Modal>
  );
}
