import { send } from '@actual-app/core/platform/client/connection';
import type { ExchangeRateEntity } from '@actual-app/core/types/models';
import { queryOptions } from '@tanstack/react-query';

export const exchangeRateQueries = {
  all: () => ['exchange-rates'],
  lists: () => [...exchangeRateQueries.all(), 'lists'],
  // Rates between one currency and another, in either direction, newest first
  list: ({
    currency,
    mainCurrency,
  }: {
    currency: string;
    mainCurrency: string;
  }) =>
    queryOptions<ExchangeRateEntity[]>({
      queryKey: [...exchangeRateQueries.lists(), currency, mainCurrency],
      queryFn: async () => {
        const [direct, inverse] = await Promise.all([
          send('exchange-rates-get', {
            from_currency: currency,
            to_currency: mainCurrency,
          }),
          send('exchange-rates-get', {
            from_currency: mainCurrency,
            to_currency: currency,
          }),
        ]);
        return [...direct, ...inverse].sort(
          (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
        );
      },
      placeholderData: [],
      // Manually invalidated when exchange rates change
      staleTime: Infinity,
    }),
};
