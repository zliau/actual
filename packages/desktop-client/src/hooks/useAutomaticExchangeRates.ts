import { useEffect } from 'react';

import { useUpdateExchangeRatesMutation } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';

/**
 * Fetches the exchange rates that are missing for accounts in another
 * currency than the main one: when the budget opens, and when an account
 * starts using a new currency.
 */
export function useAutomaticExchangeRates() {
  const mainCurrency = useMainCurrency();
  const isServerOnline = useSyncServerStatus() === 'online';
  const { data: accounts = [] } = useAccounts();
  const { mutate: updateExchangeRates } = useUpdateExchangeRatesMutation();

  const foreignCurrencies = [
    ...new Set(
      accounts
        .map(account => getForeignCurrency(account, mainCurrency))
        .filter(currency => currency != null),
    ),
  ]
    .sort()
    .join(',');

  useEffect(() => {
    if (isServerOnline && foreignCurrencies !== '') {
      updateExchangeRates();
    }
  }, [isServerOnline, mainCurrency, foreignCurrencies, updateExchangeRates]);
}
