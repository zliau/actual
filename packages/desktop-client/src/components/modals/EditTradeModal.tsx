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
  isMove,
  isValidSymbol,
  normalizeSymbol,
  sellsMoreThanHeld,
  SHARE_EPSILON,
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
import { TradeMoveAccount } from './TradeMoveAccount';
import { TradeNumberField as NumberField } from './TradeNumberField';
import { TradeSymbolSearch } from './TradeSymbolSearch';
import { TradeVestSummary } from './TradeVestSummary';

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
  // A vest's shares are entered as all that vested, withheld ones included
  const [quantityText, setQuantityText] = useState(
    trade ? formatShares(trade.quantity + trade.withheld) : '',
  );
  const [withheldText, setWithheldText] = useState(
    trade && trade.withheld > 0 ? formatShares(trade.withheld) : '',
  );
  const [priceText, setPriceText] = useState(
    trade ? formatSharePrice(trade.price) : '',
  );
  const [feeText, setFeeText] = useState(
    trade && trade.fee > 0 ? formatSharePrice(trade.fee / 100) : '',
  );
  const [amountText, setAmountText] = useState(
    trade && trade.amount > 0 ? formatSharePrice(trade.amount / 100) : '',
  );
  const [toAccount, setToAccount] = useState('');
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

  const isVest = type === 'vest';
  const isDividend = type === 'dividend';
  const isMoveTrade = isMove(type);
  const hasFee = type === 'buy' || type === 'sell';
  const enteredQuantity = isDividend ? 0 : parseExchangeRate(quantityText);
  const price = isDividend ? 0 : parseExchangeRate(shownPriceText);
  const feeAmount = feeText.trim() === '' ? 0 : currencyToAmount(feeText);
  const fee = !hasFee
    ? 0
    : feeAmount != null && feeAmount >= 0
      ? amountToInteger(feeAmount)
      : null;
  const enteredAmount = currencyToAmount(amountText);
  const amount = !isDividend
    ? 0
    : enteredAmount != null && enteredAmount > 0
      ? amountToInteger(enteredAmount)
      : null;
  // Left empty or typed as 0 when nothing was withheld
  const withheld =
    !isVest || /^[\s0.,]*$/.test(withheldText)
      ? 0
      : parseExchangeRate(withheldText);
  // What reaches the account: for a vest, what vested less what was withheld
  const quantity =
    enteredQuantity == null || withheld == null
      ? null
      : enteredQuantity - withheld;

  const normalizedSymbol = normalizeSymbol(symbol);
  const security =
    trade?.security ??
    (exchange ? getSecurityId(exchange, normalizedSymbol) : '');
  const otherTrades = trades.filter(
    other => other.security === security && other.id !== trade?.id,
  );
  const { data: securitySplits = [] } = useQuery({
    ...investmentQueries.splits({ security }),
    enabled: security !== '',
  });
  const splits = securitySplits.filter(split => split.status === 'confirmed');

  const clearError = () => setError(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();

    if (!trade && !isValidSymbol(normalizedSymbol)) {
      setError(t('Enter a symbol, like AAPL.'));
      return;
    }
    if (isDividend && amount == null) {
      setError(t('Enter the amount the dividend paid.'));
      return;
    }
    if (type === 'move-out' && !trade && toAccount === '') {
      setError(t('Choose the account the shares move to.'));
      return;
    }
    if (enteredQuantity == null) {
      setError(t('Shares must be more than zero.'));
      return;
    }
    if (withheld == null) {
      setError(t('Enter the shares withheld for tax as a number, like 37.'));
      return;
    }
    if (!isDividend && (quantity == null || quantity < SHARE_EPSILON)) {
      setError(t('Fewer shares must be withheld for tax than vested.'));
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
    if (quantity == null || amount == null) {
      return;
    }

    const fields = { date, type, quantity, price, fee, withheld, amount };
    if (sellsMoreThanHeld([...otherTrades, fields], splits)) {
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
        ...(type === 'move-out' && { transfer_account: toAccount }),
      });
    }
    close();
  };

  const onDelete = (close: () => void) => {
    if (!trade) {
      return;
    }
    if (sellsMoreThanHeld(otherTrades, splits)) {
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
                // A dividend stays a dividend and a move stays a move, so
                // delete those to make them something else
                disabled={!!trade && (isDividend || isMoveTrade)}
                options={
                  trade && isMoveTrade
                    ? [[trade.type, t('Move')]]
                    : trade && isDividend
                      ? [['dividend', t('Dividend')]]
                      : [
                          ['buy', t('Buy')],
                          ['sell', t('Sell')],
                          ['vest', t('Vest')],
                          ...(trade
                            ? []
                            : ([
                                ['dividend', t('Dividend')],
                                ['move-out', t('Move to another account')],
                              ] as const)),
                        ]
                }
                style={{ flex: 1 }}
              />
            </InlineField>
            {isDividend && (
              <Text
                style={{
                  color: theme.pageTextLight,
                  fontSize: 13,
                  marginBottom: 5,
                }}
              >
                <Trans>
                  Cash a stock paid you. It counts toward that stock's return.
                </Trans>
              </Text>
            )}
            {isMoveTrade && (
              <Text
                style={{
                  color: theme.pageTextLight,
                  fontSize: 13,
                  marginBottom: 5,
                }}
              >
                <Trans>
                  Shares moving to another of your accounts, such as from an
                  employer's plan to your own brokerage. They keep what you paid
                  for them, and no cash moves.
                </Trans>
              </Text>
            )}
            {isMoveTrade && (
              <TradeMoveAccount
                account={account}
                currency={currency}
                trade={trade}
                value={toAccount}
                onChange={value => {
                  setToAccount(value);
                  clearError();
                }}
              />
            )}
            {isVest && (
              <Text
                style={{
                  color: theme.pageTextLight,
                  fontSize: 13,
                  marginBottom: 5,
                }}
              >
                <Trans>
                  Shares you received as pay, such as RSUs. They are added at
                  their price on the vest date, and no cash leaves the account.
                </Trans>
              </Text>
            )}
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
            {isDividend && (
              <NumberField
                label={t('Amount')}
                name="amount"
                value={amountText}
                suffix={currency}
                onChange={value => {
                  setAmountText(value);
                  clearError();
                }}
              />
            )}
            {!isDividend && (
              <NumberField
                label={isVest ? t('Vested') : t('Shares')}
                name="quantity"
                value={quantityText}
                onChange={value => {
                  setQuantityText(value);
                  clearError();
                }}
              />
            )}
            {isVest && (
              <NumberField
                label={t('Withheld')}
                name="withheld"
                value={withheldText}
                suffix={t('for tax')}
                onChange={value => {
                  setWithheldText(value);
                  clearError();
                }}
              />
            )}
            {!isDividend && (
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
            )}
            {isLookupReady && !isDividend && (
              <TradeCloseHint
                currency={currency}
                result={closeResult}
                isLoading={isLookingUpClose}
              />
            )}
            {hasFee && (
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
            )}

            {error && <FormError style={{ marginTop: 5 }}>{error}</FormError>}

            {isVest &&
              enteredQuantity != null &&
              quantity != null &&
              quantity > 0 &&
              withheld != null &&
              price != null && (
                <TradeVestSummary
                  received={quantity}
                  pay={amountToInteger(enteredQuantity * price)}
                  tax={amountToInteger(withheld * price)}
                  currency={currency}
                />
              )}
            {(hasFee || isDividend) &&
              quantity != null &&
              price != null &&
              fee != null &&
              amount != null && (
                <Text style={{ color: theme.pageTextLight, marginTop: 10 }}>
                  <Trans>Cash change</Trans>{' '}
                  <FinancialText style={{ fontWeight: 600 }}>
                    {format(
                      getTradeCashAmount({
                        type,
                        quantity,
                        price,
                        fee,
                        amount,
                      }),
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
