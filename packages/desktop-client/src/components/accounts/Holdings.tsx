import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity, Holding } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';
import { format as formatDate, parseISO } from 'date-fns';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import {
  formatGainRatio,
  formatSharePrice,
  formatShares,
  investmentQueries,
} from '#investments';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { HoldingsDividendSuggestion } from './HoldingsDividendSuggestion';
import { HoldingsNumberCell as NumberCell } from './HoldingsNumberCell';
import { HoldingsPriceUpdate } from './HoldingsPriceUpdate';
import { HoldingsRow as Row } from './HoldingsRow';
import { HoldingsSplitSuggestion } from './HoldingsSplitSuggestion';

const COLUMNS = {
  shares: 90,
  averageCost: 100,
  price: 100,
  priceDate: 100,
  marketValue: 120,
  gain: 120,
  gainRatio: 70,
  realized: 110,
};

type HoldingsProps = {
  account: AccountEntity;
};

export function Holdings({ account }: HoldingsProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { data } = useQuery(
    investmentQueries.holdings({ account: account.id }),
  );

  const currency = account.currency ?? '';
  const isReadOnly = account.closed === 1;
  const holdings = data?.holdings ?? [];

  const money = (amount: number, withSign = false) =>
    format(amount, withSign ? 'financial-with-sign' : 'financial', currency);

  const total = (field: 'marketValue' | 'unrealizedGain' | 'realizedGain') =>
    holdings.reduce((sum, holding) => sum + holding[field], 0);
  const totalCost = holdings.reduce(
    (sum, holding) => sum + holding.costBasis,
    0,
  );

  const onOpen = (holding: Holding) => {
    dispatch(
      pushModal({
        modal: {
          name: 'holding-details',
          options: {
            account: account.id,
            security: holding.security,
            symbol: holding.symbol,
            currency,
            isReadOnly,
          },
        },
      }),
    );
  };

  return (
    <View
      style={{
        ...styles.pageContent,
        flexShrink: 0,
        paddingBottom: 15,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 15,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 500 }}>
          <Trans>Holdings</Trans>
        </Text>
        {data && (
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Cash</Trans>{' '}
            <PrivacyFilter>
              <FinancialText>{money(data.cash)}</FinancialText>
            </PrivacyFilter>
          </Text>
        )}
        <View style={{ flex: 1 }} />
        {!isReadOnly && <HoldingsPriceUpdate currency={currency} />}
        {!isReadOnly && (
          <Button
            onPress={() =>
              dispatch(
                pushModal({
                  modal: {
                    name: 'edit-trade',
                    options: { account: account.id, currency },
                  },
                }),
              )
            }
          >
            <Trans>Add trade</Trans>
          </Button>
        )}
      </View>

      {data?.suggestedSplits.map(split => (
        <HoldingsSplitSuggestion key={split.id} split={split} />
      ))}

      {!isReadOnly &&
        data?.suggestedDividends.map(dividend => (
          <HoldingsDividendSuggestion
            key={dividend.id}
            dividend={dividend}
            currency={currency}
          />
        ))}

      <View
        style={{
          border: `1px solid ${theme.tableBorder}`,
          borderRadius: 6,
          overflow: 'hidden',
          overflowX: 'auto',
          backgroundColor: theme.tableBackground,
        }}
      >
        <View style={{ minWidth: 930 }}>
          <Row
            style={{
              fontSize: 13,
              color: theme.tableHeaderText,
              backgroundColor: theme.tableHeaderBackground,
              borderBottom: `1px solid ${theme.tableBorder}`,
            }}
          >
            <Text style={{ flex: 1, minWidth: 60 }}>
              <Trans>Symbol</Trans>
            </Text>
            <NumberCell width={COLUMNS.shares}>
              <Trans>Shares</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.averageCost}>
              <Trans>Average cost</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.price}>
              <Trans>Price</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.priceDate}>
              <Trans>Price date</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.marketValue}>
              <Trans>Value</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.gain + COLUMNS.gainRatio}>
              <Trans>Unrealized gain</Trans>
            </NumberCell>
            <NumberCell width={COLUMNS.realized}>
              <Trans>Realized gain</Trans>
            </NumberCell>
          </Row>

          {data && holdings.length === 0 && (
            <Text
              style={{
                padding: '20px 10px',
                textAlign: 'center',
                color: theme.pageTextSubdued,
              }}
            >
              <Trans>No holdings yet. Add a trade to get started.</Trans>
            </Text>
          )}

          <View style={{ maxHeight: 200, overflowY: 'auto' }}>
            {holdings.map(holding => {
              const isOpen = holding.quantity > 0;
              return (
                <Button
                  key={holding.security}
                  variant="bare"
                  aria-label={t('Open {{symbol}}', { symbol: holding.symbol })}
                  onPress={() => onOpen(holding)}
                  style={{
                    padding: 0,
                    borderRadius: 0,
                    justifyContent: 'flex-start',
                    color: theme.tableText,
                    borderBottom: `1px solid ${theme.tableBorder}`,
                  }}
                >
                  <Row style={{ flex: 1 }}>
                    <Text
                      style={{ flex: 1, minWidth: 60, textAlign: 'left' }}
                      title={holding.name ?? undefined}
                    >
                      {holding.symbol}
                    </Text>
                    <NumberCell width={COLUMNS.shares}>
                      {formatShares(holding.quantity)}
                    </NumberCell>
                    <NumberCell width={COLUMNS.averageCost}>
                      {isOpen && (
                        <PrivacyFilter>
                          {formatSharePrice(holding.averageCost)}
                        </PrivacyFilter>
                      )}
                    </NumberCell>
                    <NumberCell width={COLUMNS.price}>
                      {isOpen && formatSharePrice(holding.price)}
                    </NumberCell>
                    <NumberCell
                      width={COLUMNS.priceDate}
                      style={{ color: theme.pageTextLight }}
                    >
                      {isOpen &&
                        formatDate(parseISO(holding.priceDate), dateFormat)}
                    </NumberCell>
                    <NumberCell width={COLUMNS.marketValue}>
                      {isOpen && (
                        <PrivacyFilter>
                          {money(holding.marketValue)}
                        </PrivacyFilter>
                      )}
                    </NumberCell>
                    <NumberCell
                      width={COLUMNS.gain}
                      style={gainStyle(holding.unrealizedGain)}
                    >
                      {isOpen && (
                        <PrivacyFilter>
                          {money(holding.unrealizedGain, true)}
                        </PrivacyFilter>
                      )}
                    </NumberCell>
                    <NumberCell
                      width={COLUMNS.gainRatio}
                      style={gainStyle(holding.unrealizedGain)}
                    >
                      {isOpen && formatGainRatio(holding.unrealizedGainRatio)}
                    </NumberCell>
                    <NumberCell
                      width={COLUMNS.realized}
                      style={gainStyle(holding.realizedGain)}
                    >
                      {holding.realizedGain !== 0 && (
                        <PrivacyFilter>
                          {money(holding.realizedGain, true)}
                        </PrivacyFilter>
                      )}
                    </NumberCell>
                  </Row>
                </Button>
              );
            })}
          </View>

          {holdings.length > 1 && (
            <Row
              style={{
                fontWeight: 600,
                backgroundColor: theme.tableHeaderBackground,
              }}
            >
              <Text style={{ flex: 1, minWidth: 60 }}>
                <Trans>Total</Trans>
              </Text>
              <NumberCell
                width={
                  COLUMNS.shares +
                  COLUMNS.averageCost +
                  COLUMNS.price +
                  COLUMNS.priceDate
                }
              />
              <NumberCell width={COLUMNS.marketValue}>
                <PrivacyFilter>{money(total('marketValue'))}</PrivacyFilter>
              </NumberCell>
              <NumberCell
                width={COLUMNS.gain}
                style={gainStyle(total('unrealizedGain'))}
              >
                <PrivacyFilter>
                  {money(total('unrealizedGain'), true)}
                </PrivacyFilter>
              </NumberCell>
              <NumberCell
                width={COLUMNS.gainRatio}
                style={gainStyle(total('unrealizedGain'))}
              >
                {totalCost > 0 &&
                  formatGainRatio(total('unrealizedGain') / totalCost)}
              </NumberCell>
              <NumberCell
                width={COLUMNS.realized}
                style={gainStyle(total('realizedGain'))}
              >
                <PrivacyFilter>
                  {money(total('realizedGain'), true)}
                </PrivacyFilter>
              </NumberCell>
            </Row>
          )}
        </View>
      </View>
    </View>
  );
}

function gainStyle(amount: number): CSSProperties | undefined {
  if (amount === 0) {
    return undefined;
  }
  return { color: amount > 0 ? theme.numberPositive : theme.numberNegative };
}
