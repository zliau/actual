import { useEffect } from 'react';

import { listen } from '@actual-app/core/platform/client/connection';

import { useUpdateExchangeRatesMutation } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';

// Transactions often change in bursts, like an import or a bank sync
const TRANSACTIONS_CHANGED_DELAY_MS = 10 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Fetches the exchange rates that are missing for accounts in another
 * currency than the main one: when the budget opens, when an account starts
 * using a new currency, when transactions change, since they can be older than
 * any rate known, and regularly for a budget that stays open.
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
    if (!isServerOnline || foreignCurrencies === '') {
      return;
    }

    updateExchangeRates();

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen('sync-event', event => {
      if (
        (event.type === 'applied' || event.type === 'success') &&
        event.tables.includes('transactions') &&
        timeout == null
      ) {
        timeout = setTimeout(() => {
          timeout = null;
          updateExchangeRates();
        }, TRANSACTIONS_CHANGED_DELAY_MS);
      }
    });
    const interval = setInterval(updateExchangeRates, REFRESH_INTERVAL_MS);

    return () => {
      unlisten();
      clearInterval(interval);
      if (timeout != null) {
        clearTimeout(timeout);
      }
    };
  }, [isServerOnline, mainCurrency, foreignCurrencies, updateExchangeRates]);
}
