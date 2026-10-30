import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';

import { CellValue } from '#components/spreadsheet/CellValue';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useMissingExchangeRates } from '#hooks/useMissingExchangeRates';
import { accountBalanceInMainCurrency } from '#spreadsheet/bindings';

type AccountMainCurrencyBalanceProps = {
  account: AccountEntity;
};

// The balance of an account in another currency, valued in the main currency
export function AccountMainCurrencyBalance({
  account,
}: AccountMainCurrencyBalanceProps) {
  const mainCurrency = useMainCurrency();
  const missingCurrencies = useMissingExchangeRates();
  const currency = getForeignCurrency(account, mainCurrency);

  if (currency == null) {
    return null;
  }

  return (
    <View
      style={{
        alignItems: 'flex-end',
        fontSize: 11,
        fontWeight: 400,
        color: missingCurrencies.includes(currency)
          ? theme.warningText
          : theme.sidebarTextSubdued,
      }}
    >
      {missingCurrencies.includes(currency) ? (
        <Trans>No rate</Trans>
      ) : (
        <CellValue<'account', 'balanceInMainCurrency'>
          binding={accountBalanceInMainCurrency(account.id)}
          type="financial"
        />
      )}
    </View>
  );
}
