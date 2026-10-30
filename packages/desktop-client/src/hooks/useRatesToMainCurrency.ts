import { useQuery } from '@tanstack/react-query';

import { exchangeRateQueries, findExchangeRate } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';

/**
 * Gives how many units of the main currency one unit of `currency` is worth on
 * `date`: 1 for the main currency or when there is none, and 0 when no rate is
 * known, since those amounts can't be valued.
 */
export function useRatesToMainCurrency() {
  const mainCurrency = useMainCurrency();
  const { data: accounts = [] } = useAccounts();

  const currencies = [
    ...new Set(
      accounts
        .map(account => getForeignCurrency(account, mainCurrency))
        .filter(currency => currency != null),
    ),
  ].sort();

  const { data: rates = [] } = useQuery({
    ...exchangeRateQueries.toMainCurrency({
      currencies,
      mainCurrency: mainCurrency ?? '',
    }),
    enabled: mainCurrency != null && currencies.length > 0,
  });

  return (currency: string | null | undefined, date: string) =>
    currency && mainCurrency
      ? (findExchangeRate(rates, currency, mainCurrency, date) ?? 0)
      : 1;
}
