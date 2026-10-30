import { useQuery } from '@tanstack/react-query';

import { exchangeRateQueries } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { getForeignCurrency, useMainCurrency } from '#hooks/useMainCurrency';

/**
 * The currencies of accounts that have no exchange rate to the main currency.
 * Amounts in them don't count towards totals until a rate is known.
 */
export function useMissingExchangeRates(): string[] {
  const mainCurrency = useMainCurrency();
  const { data: accounts = [] } = useAccounts();

  const currencies = [
    ...new Set(
      accounts
        .map(account => getForeignCurrency(account, mainCurrency))
        .filter(currency => currency != null),
    ),
  ].sort();

  const { data: missing = [] } = useQuery({
    ...exchangeRateQueries.missing({
      currencies,
      mainCurrency: mainCurrency ?? '',
    }),
    enabled: mainCurrency != null && currencies.length > 0,
  });

  return currencies.length > 0 ? missing : [];
}
