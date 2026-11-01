import { send } from '@actual-app/core/platform/client/connection';
import type {
  AccountHoldings,
  SecurityPriceEntity,
  TradeEntity,
} from '@actual-app/core/types/models';
import { queryOptions } from '@tanstack/react-query';

export const investmentQueries = {
  all: () => ['investments'],
  lists: () => [...investmentQueries.all(), 'lists'],
  holdings: ({ account }: { account: string }) =>
    queryOptions<AccountHoldings>({
      queryKey: [...investmentQueries.lists(), 'holdings', account],
      queryFn: () => send('holdings-get', { account }),
      // Manually invalidated when trades, prices or transactions change
      staleTime: Infinity,
    }),
  trades: ({ account }: { account: string }) =>
    queryOptions<TradeEntity[]>({
      queryKey: [...investmentQueries.lists(), 'trades', account],
      queryFn: () => send('trades-get', { account }),
      placeholderData: [],
      // Manually invalidated when trades change
      staleTime: Infinity,
    }),
  prices: ({ security }: { security: string }) =>
    queryOptions<SecurityPriceEntity[]>({
      queryKey: [...investmentQueries.lists(), 'prices', security],
      queryFn: () => send('security-prices-get', { security }),
      placeholderData: [],
      // Manually invalidated when prices change
      staleTime: Infinity,
    }),
};
