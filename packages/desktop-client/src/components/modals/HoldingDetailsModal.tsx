import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { View } from '@actual-app/components/view';
import {
  getTradeCashAmount,
  isCashOnly,
} from '@actual-app/core/shared/investments';
import type {
  SecurityEntity,
  TradeEntity,
} from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';
import { format as formatDate, parseISO } from 'date-fns';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import {
  formatSharePrice,
  formatShares,
  formatSplitRatio,
  investmentQueries,
} from '#investments';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { HoldingDetailsRow as ListRow } from './HoldingDetailsRow';
import { HoldingDetailsSectionHeader as SectionHeader } from './HoldingDetailsSectionHeader';
import { HoldingDetailsTable as ListTable } from './HoldingDetailsTable';

type HoldingDetailsModalProps = {
  account: TradeEntity['account'];
  security: SecurityEntity['id'];
  symbol: string;
  currency: string;
  isReadOnly: boolean;
};

export function HoldingDetailsModal({
  account,
  security,
  symbol,
  currency,
  isReadOnly,
}: HoldingDetailsModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { data: allTrades = [] } = useQuery(
    investmentQueries.trades({ account }),
  );
  const { data: prices = [] } = useQuery(
    investmentQueries.prices({ security }),
  );
  const { data: allSplits = [] } = useQuery(
    investmentQueries.splits({ security }),
  );
  const splits = allSplits.filter(split => split.status === 'confirmed');
  const trades = allTrades.filter(trade => trade.security === security);

  const showDate = (date: string) => formatDate(parseISO(date), dateFormat);

  const onEditTrade = (trade?: TradeEntity) => {
    if (isReadOnly) {
      return;
    }
    dispatch(
      pushModal({
        modal: {
          name: 'edit-trade',
          options: { account, currency, symbol, trade },
        },
      }),
    );
  };

  return (
    <Modal name="holding-details" containerProps={{ style: { width: 560 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={symbol} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 20 }}>
            <View style={{ gap: 8 }}>
              <SectionHeader title={t('Trades')}>
                {!isReadOnly && (
                  <Button onPress={() => onEditTrade()}>
                    <Trans>Add trade</Trans>
                  </Button>
                )}
              </SectionHeader>
              <ListTable
                columns={[
                  t('Date'),
                  t('Type'),
                  t('Shares'),
                  t('Price'),
                  t('Cash'),
                ]}
              >
                {trades.map(trade => (
                  <ListRow
                    key={trade.id}
                    label={t('Edit trade from {{date}}', {
                      date: showDate(trade.date),
                    })}
                    isDisabled={isReadOnly}
                    onPress={() => onEditTrade(trade)}
                    cells={[
                      showDate(trade.date),
                      {
                        buy: t('Buy'),
                        sell: t('Sell'),
                        vest: t('Vest'),
                        dividend: t('Dividend'),
                        'reinvested-dividend': t('Reinvested dividend'),
                        'return-of-capital': t('Return of capital'),
                        'move-in': t('Moved in'),
                        'move-out': t('Moved out'),
                      }[trade.type],
                      isCashOnly(trade.type)
                        ? ''
                        : formatShares(trade.quantity),
                      isCashOnly(trade.type)
                        ? ''
                        : formatSharePrice(trade.price),
                      getTradeCashAmount(trade) !== 0
                        ? format(
                            getTradeCashAmount(trade),
                            'financial-with-sign',
                            currency,
                          )
                        : '',
                    ]}
                  />
                ))}
              </ListTable>
            </View>

            <View style={{ gap: 8 }}>
              <SectionHeader title={t('Splits')}>
                <Button
                  onPress={() =>
                    dispatch(
                      pushModal({
                        modal: {
                          name: 'edit-security-split',
                          options: { security, symbol },
                        },
                      }),
                    )
                  }
                >
                  <Trans>Add split</Trans>
                </Button>
              </SectionHeader>
              <ListTable
                columns={[t('Date'), t('Ratio')]}
                emptyMessage={t('No splits entered.')}
              >
                {splits.map(split => (
                  <ListRow
                    key={split.id}
                    label={t('Edit split on {{date}}', {
                      date: showDate(split.date),
                    })}
                    onPress={() =>
                      dispatch(
                        pushModal({
                          modal: {
                            name: 'edit-security-split',
                            options: { security, symbol, split },
                          },
                        }),
                      )
                    }
                    cells={[
                      showDate(split.date),
                      formatSplitRatio(split.ratio),
                    ]}
                  />
                ))}
              </ListTable>
            </View>

            <View style={{ gap: 8 }}>
              <SectionHeader title={t('Prices')}>
                <Button
                  onPress={() =>
                    dispatch(
                      pushModal({
                        modal: {
                          name: 'edit-security-price',
                          options: { security, symbol, currency },
                        },
                      }),
                    )
                  }
                >
                  <Trans>Add price</Trans>
                </Button>
              </SectionHeader>
              <ListTable
                columns={[t('Date'), t('Close'), t('Source')]}
                emptyMessage={t(
                  'No prices yet. The value uses the price of your latest trade.',
                )}
              >
                {prices.map(price => (
                  <ListRow
                    key={price.id}
                    label={t('Edit price for {{date}}', {
                      date: showDate(price.date),
                    })}
                    onPress={() =>
                      dispatch(
                        pushModal({
                          modal: {
                            name: 'edit-security-price',
                            options: { security, symbol, currency, price },
                          },
                        }),
                      )
                    }
                    cells={[
                      showDate(price.date),
                      formatSharePrice(price.close),
                      price.source === 'manual'
                        ? t('Entered')
                        : t('Downloaded'),
                    ]}
                  />
                ))}
              </ListTable>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}
