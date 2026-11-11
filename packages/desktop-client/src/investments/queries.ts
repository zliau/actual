import { send } from '@actual-app/core/platform/client/connection';
import type {
  AccountHoldings,
  InvestmentPerformance,
  SecurityCloseResult,
  SecurityExchange,
  SecurityPriceEntity,
  SecuritySplitEntity,
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
  // Which exchanges have a key to fetch prices with. This asks the server, so it
  // is kept apart from the lists that refresh on every change.
  priceStatus: () =>
    queryOptions({
      queryKey: [...investmentQueries.all(), 'price-status'],
      queryFn: () => send('security-prices-status'),
      // Manually invalidated when the keys change
      staleTime: Infinity,
    }),
  // A close to suggest as a trade's price. Kept apart from the lists, since
  // those refresh on every change and this can use up a provider's allowance.
  close: ({
    exchange,
    symbol,
    date,
  }: {
    exchange: SecurityExchange;
    symbol: string;
    date: string;
  }) =>
    queryOptions<SecurityCloseResult>({
      queryKey: [...investmentQueries.all(), 'close', exchange, symbol, date],
      queryFn: () => send('security-close-get', { exchange, symbol, date }),
      staleTime: Infinity,
      retry: false,
    }),
  performance: ({ account }: { account: string }) =>
    queryOptions<InvestmentPerformance>({
      queryKey: [...investmentQueries.lists(), 'performance', account],
      queryFn: () => send('investment-performance-get', { account }),
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
  splits: ({ security }: { security: string }) =>
    queryOptions<SecuritySplitEntity[]>({
      queryKey: [...investmentQueries.lists(), 'splits', security],
      queryFn: () => send('security-splits-get', { security }),
      placeholderData: [],
      // Manually invalidated when splits change
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
