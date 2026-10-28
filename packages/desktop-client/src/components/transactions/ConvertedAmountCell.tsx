import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgExclamationOutline } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Tooltip } from '@actual-app/components/tooltip';
import {
  isPreviewId,
  isTemporaryId,
} from '@actual-app/core/shared/transactions';
import { integerToCurrency } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { Cell } from '#components/table';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type ConvertedAmountCellProps = {
  transaction: Pick<
    TransactionEntity,
    'id' | 'date' | 'amount' | 'converted_amount'
  >;
  account: AccountEntity | undefined;
  width: number;
  style?: CSSProperties | null;
};

// The amount of a transaction in the main currency, converted with the
// exchange rate of its date
export function ConvertedAmountCell({
  transaction,
  account,
  width,
  style,
}: ConvertedAmountCellProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const mainCurrency = useMainCurrency();
  const currency = getForeignCurrency(account, mainCurrency);

  // Scheduled and unsaved transactions are converted once they're saved
  const isSaved =
    !isPreviewId(transaction.id) && !isTemporaryId(transaction.id);

  if (
    isSaved &&
    currency != null &&
    mainCurrency != null &&
    transaction.converted_amount == null
  ) {
    return (
      <Cell name="converted" width={width} plain>
        <Tooltip
          content={
            <Text style={{ padding: 8, maxWidth: 260, lineHeight: 1.5 }}>
              <Trans>
                No exchange rate from {{ currency }} to {{ mainCurrency }} is
                known for this date yet. Add one to convert this transaction.
              </Trans>
            </Text>
          }
          placement="bottom end"
        >
          <Button
            variant="bare"
            aria-label={t('Add an exchange rate for this date')}
            onPress={() =>
              dispatch(
                pushModal({
                  modal: {
                    name: 'edit-exchange-rate',
                    options: {
                      fromCurrency: currency,
                      toCurrency: mainCurrency,
                      date: transaction.date,
                    },
                  },
                }),
              )
            }
            style={{
              flex: 1,
              justifyContent: 'flex-end',
              gap: 4,
              borderRadius: 0,
              fontSize: 13,
              color: theme.warningText,
            }}
          >
            <SvgExclamationOutline
              style={{ width: 12, height: 12, flexShrink: 0 }}
            />
            <Trans>No rate</Trans>
          </Button>
        </Tooltip>
      </Cell>
    );
  }

  // Transactions in the main currency need no conversion
  const value = !isSaved
    ? null
    : currency == null
      ? transaction.amount
      : transaction.converted_amount;

  return (
    <Cell
      name="converted"
      width={width}
      textAlign="right"
      value={value == null ? '' : integerToCurrency(value)}
      valueStyle={{
        color: value != null && value < 0 ? theme.numberNegative : undefined,
      }}
      style={{ ...styles.tnum, ...style }}
      privacyFilter
    />
  );
}
