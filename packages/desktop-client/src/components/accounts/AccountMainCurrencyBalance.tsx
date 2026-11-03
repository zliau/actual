import { Trans } from 'react-i18next';

import type { CSSProperties } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { AccountEntity } from '@actual-app/core/types/models';

import { CellValue, CellValueText } from '#components/spreadsheet/CellValue';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useMissingExchangeRates } from '#hooks/useMissingExchangeRates';
import { accountBalanceInMainCurrency } from '#spreadsheet/bindings';

type AccountMainCurrencyBalanceProps = {
  account: AccountEntity;
  // Font and colour of the amount; "No rate" always shows as a warning
  style?: CSSProperties;
};

// The balance of an account in another currency, valued in the main currency.
// Shows nothing for accounts in the main currency.
export function AccountMainCurrencyBalance({
  account,
  style,
}: AccountMainCurrencyBalanceProps) {
  const mainCurrency = useMainCurrency();
  const missingCurrencies = useMissingExchangeRates();
  const currency = getForeignCurrency(account, mainCurrency);

  if (currency == null) {
    return null;
  }

  if (missingCurrencies.includes(currency)) {
    return (
      <Text
        style={{
          textAlign: 'right',
          whiteSpace: 'nowrap',
          ...style,
          color: theme.warningText,
        }}
      >
        <Trans>No rate</Trans>
      </Text>
    );
  }

  return (
    <CellValue<'account', 'balanceInMainCurrency'>
      binding={accountBalanceInMainCurrency(account.id)}
      type="financial"
    >
      {props => (
        <CellValueText<'account', 'balanceInMainCurrency'>
          {...props}
          style={{ textAlign: 'right', ...style }}
        />
      )}
    </CellValue>
  );
}
