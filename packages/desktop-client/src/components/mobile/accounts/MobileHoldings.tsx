import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { HoldingsSplitSuggestion } from '#components/accounts/HoldingsSplitSuggestion';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { formatGainRatio, formatShares, investmentQueries } from '#investments';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type MobileHoldingsProps = {
  account: AccountEntity;
};

export function MobileHoldings({ account }: MobileHoldingsProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const format = useFormat();
  const { data } = useQuery(
    investmentQueries.holdings({ account: account.id }),
  );

  const currency = account.currency ?? '';
  const isReadOnly = account.closed === 1;

  return (
    <View
      style={{
        flexShrink: 0,
        padding: 10,
        gap: 8,
        backgroundColor: theme.mobilePageBackground,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: 500 }}>
          <Trans>Holdings</Trans>
        </Text>
        {data && (
          <Text style={{ flex: 1, color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Cash</Trans>{' '}
            <PrivacyFilter>
              <FinancialText>
                {format(data.cash, 'financial', currency)}
              </FinancialText>
            </PrivacyFilter>
          </Text>
        )}
        {!isReadOnly && (
          <Button
            style={{ height: styles.mobileMinHeight }}
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

      {data && data.holdings.length > 0 && (
        <View
          style={{
            maxHeight: 180,
            overflowY: 'auto',
            border: `1px solid ${theme.tableBorder}`,
            borderRadius: 6,
            backgroundColor: theme.tableBackground,
          }}
        >
          {data.holdings.map(holding => {
            const isOpen = holding.quantity > 0;
            const gain = isOpen ? holding.unrealizedGain : holding.realizedGain;
            return (
              <Button
                key={holding.security}
                variant="bare"
                aria-label={t('Open {{symbol}}', { symbol: holding.symbol })}
                onPress={() =>
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
                  )
                }
                style={{
                  flexShrink: 0,
                  minHeight: styles.mobileMinHeight,
                  padding: '6px 10px',
                  borderRadius: 0,
                  justifyContent: 'space-between',
                  color: theme.tableText,
                  borderBottom: `1px solid ${theme.tableBorder}`,
                }}
              >
                <View style={{ alignItems: 'flex-start' }}>
                  <Text style={{ fontWeight: 500 }}>{holding.symbol}</Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.pageTextLight,
                      ...styles.tnum,
                    }}
                  >
                    {isOpen ? (
                      <Trans>
                        {{ shares: formatShares(holding.quantity) }} shares
                      </Trans>
                    ) : (
                      <Trans>Sold</Trans>
                    )}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <PrivacyFilter>
                    <FinancialText>
                      {isOpen
                        ? format(holding.marketValue, 'financial', currency)
                        : format(gain, 'financial-with-sign', currency)}
                    </FinancialText>
                  </PrivacyFilter>
                  {isOpen && (
                    <Text
                      style={{
                        fontSize: 13,
                        ...styles.tnum,
                        color:
                          gain === 0
                            ? theme.pageTextLight
                            : gain > 0
                              ? theme.numberPositive
                              : theme.numberNegative,
                      }}
                    >
                      <PrivacyFilter>
                        {format(gain, 'financial-with-sign', currency)}
                      </PrivacyFilter>{' '}
                      ({formatGainRatio(holding.unrealizedGainRatio)})
                    </Text>
                  )}
                </View>
              </Button>
            );
          })}
        </View>
      )}

      {data?.holdings.length === 0 && (
        <Text style={{ color: theme.pageTextSubdued, textAlign: 'center' }}>
          <Trans>No holdings yet. Add a trade to get started.</Trans>
        </Text>
      )}
    </View>
  );
}
