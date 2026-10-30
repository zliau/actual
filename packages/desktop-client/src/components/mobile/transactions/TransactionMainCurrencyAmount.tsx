import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgExclamationOutline } from '@actual-app/components/icons/v1';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useRatesToMainCurrency } from '#hooks/useRatesToMainCurrency';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type TransactionMainCurrencyAmountProps = {
  transaction: TransactionEntity;
  account: AccountEntity | undefined;
};

// What the amount being edited is worth in the main currency
export function TransactionMainCurrencyAmount({
  transaction,
  account,
}: TransactionMainCurrencyAmountProps) {
  const dispatch = useDispatch();
  const format = useFormat();
  const mainCurrency = useMainCurrency();
  const getRate = useRatesToMainCurrency();
  const currency = getForeignCurrency(account, mainCurrency);

  if (currency == null || mainCurrency == null) {
    return null;
  }

  const rate = getRate(currency, transaction.date);
  // Transfers are worth what the other side received, and the parts of a split
  // are rounded on their own, so those can't be estimated from the rate
  const value =
    (transaction.transfer_id || transaction.is_parent
      ? transaction.converted_amount
      : null) ??
    (rate > 0 ? Math.round((transaction.amount ?? 0) * rate) : null);

  if (value == null) {
    return (
      <Button
        variant="bare"
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
        style={{ gap: 4, marginTop: 4, color: theme.warningText }}
      >
        <SvgExclamationOutline style={{ width: 12, height: 12 }} />
        <Trans>
          Add a {{ currency }} to {{ mainCurrency }} rate
        </Trans>
      </Button>
    );
  }

  return (
    <Text style={{ marginTop: 4, color: theme.pageTextLight }}>
      <Trans>In {{ mainCurrency }}:</Trans>{' '}
      <PrivacyFilter>
        <FinancialText>{format(value, 'financial')}</FinancialText>
      </PrivacyFilter>
    </Text>
  );
}
