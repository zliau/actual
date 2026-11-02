import type {
  Holding,
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
  SecuritySplitEntity,
  TradeEntity,
} from '#types/models';

import * as monthUtils from './months';
import { amountToInteger } from './util';

// Below this a position counts as fully sold, so rounding in fractional shares
// can't leave a tiny remainder or block selling everything.
export const SHARE_EPSILON = 0.000001;

// Filters out what investment accounts write themselves, for reports of income
// and spending: a price change or a trade is neither
export const NOT_INVESTMENT_ACTIVITY = { investment_type: null };

const RECENT_PRICE_DAYS = 60;

const EXCHANGE_CURRENCIES: Record<SecurityExchange, string> = {
  US: 'USD',
  TSX: 'CAD',
};

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL.test(symbol);
}

// Comes from the exchange and symbol so devices adding the same security while
// they can't sync end up with one row
export function getSecurityId(
  exchange: SecurityExchange,
  symbol: string,
): SecurityEntity['id'] {
  return `${exchange}-${symbol}`;
}

export function isSecurityExchange(value: string): value is SecurityExchange {
  return Object.hasOwn(EXCHANGE_CURRENCIES, value);
}

export function getExchangeCurrency(exchange: SecurityExchange): string {
  return EXCHANGE_CURRENCIES[exchange];
}

export function getCurrencyExchange(currency: string): SecurityExchange | null {
  const exchange = Object.keys(EXCHANGE_CURRENCIES).find(
    code => EXCHANGE_CURRENCIES[code as SecurityExchange] === currency,
  );
  return (exchange as SecurityExchange | undefined) ?? null;
}

export function isInvestmentCurrency(currency: string): boolean {
  return Object.values(EXCHANGE_CURRENCIES).includes(currency);
}

// The change in the account's cash, in cents. A buy costs the shares plus the
// fee, and a sell brings in the shares less the fee.
export function getTradeCashAmount({
  type,
  quantity,
  price,
  fee,
}: Pick<TradeEntity, 'type' | 'quantity' | 'price' | 'fee'>): number {
  const value = amountToInteger(quantity * price);
  return type === 'buy' ? -(value + fee) : value - fee;
}

type Split = Pick<SecuritySplitEntity, 'date' | 'ratio'>;

// Oldest first. A split takes effect before the market opens, so on its day it
// comes before any trade, and buys come before sells.
function sortEvents<T extends Pick<TradeEntity, 'date' | 'type'>>(
  trades: T[],
  splits: Split[],
): Array<(T & { kind: 'trade' }) | (Split & { kind: 'split' })> {
  const order = (event: { kind: string; type?: string }) =>
    event.kind === 'split' ? 0 : event.type === 'buy' ? 1 : 2;
  return [
    ...trades.map(trade => ({ ...trade, kind: 'trade' as const })),
    ...splits.map(split => ({ ...split, kind: 'split' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
}

// Whether a security's trades ever sell more shares than are held at that
// point, once its splits are counted.
export function sellsMoreThanHeld(
  trades: Array<Pick<TradeEntity, 'date' | 'type' | 'quantity'>>,
  splits: Split[] = [],
): boolean {
  let held = 0;
  for (const event of sortEvents(trades, splits)) {
    if (event.kind === 'split') {
      held *= event.ratio;
    } else {
      held += event.type === 'buy' ? event.quantity : -event.quantity;
    }
    if (held < -SHARE_EPSILON) {
      return true;
    }
  }
  return false;
}

// Works out a position from all of a security's trades, using average cost: a
// buy adds its value and fee to the cost, and a sell takes out its share of the
// cost at the average. A split changes the shares but not the cost. The price is
// the latest close, or the latest trade's price when that is newer, adjusted for
// any split since then.
export function calculateHolding(
  security: Pick<SecurityEntity, 'id' | 'symbol' | 'name' | 'currency'>,
  trades: Array<
    Pick<TradeEntity, 'date' | 'type' | 'quantity' | 'price' | 'fee'>
  >,
  latestPrice?: Pick<SecurityPriceEntity, 'date' | 'close'>,
  splits: Split[] = [],
): Holding {
  let quantity = 0;
  let costBasis = 0;
  let realizedGain = 0;
  let lastTrade: (typeof trades)[number] | undefined;
  for (const event of sortEvents(trades, splits)) {
    if (event.kind === 'split') {
      quantity *= event.ratio;
    } else {
      lastTrade = event;
      const value = amountToInteger(event.quantity * event.price);
      if (event.type === 'buy') {
        quantity += event.quantity;
        costBasis += value + event.fee;
      } else {
        const remaining = quantity - event.quantity;
        const isSoldOut = remaining < SHARE_EPSILON;
        const costSold = isSoldOut
          ? costBasis
          : Math.round((costBasis * event.quantity) / quantity);
        realizedGain += value - event.fee - costSold;
        costBasis -= costSold;
        quantity = isSoldOut ? 0 : remaining;
      }
    }
  }

  const isCloseCurrent =
    latestPrice != null &&
    (lastTrade == null || latestPrice.date >= lastTrade.date);
  const priceDate = isCloseCurrent ? latestPrice.date : (lastTrade?.date ?? '');
  // A price from before a split is for shares that have since been divided
  const laterSplits = splits.filter(split => split.date > priceDate);
  const price = laterSplits.reduce(
    (adjusted, split) => adjusted / split.ratio,
    isCloseCurrent ? latestPrice.close : (lastTrade?.price ?? 0),
  );

  const marketValue = amountToInteger(quantity * price);
  const unrealizedGain = marketValue - costBasis;

  return {
    security: security.id,
    symbol: security.symbol,
    name: security.name,
    currency: security.currency,
    quantity,
    averageCost: quantity > 0 ? costBasis / 100 / quantity : 0,
    costBasis,
    price,
    priceDate,
    marketValue,
    unrealizedGain,
    unrealizedGainRatio: costBasis > 0 ? unrealizedGain / costBasis : 0,
    realizedGain,
  };
}

export type MarketValueChange = {
  security: SecurityEntity['id'];
  month: string;
  date: string;
  // The change in value over the month, in cents
  amount: number;
  // What was held at the end of the month, and the price it was valued at
  quantity: number;
  price: number;
};

// What the account's market value transactions should be: for each security
// and each month from its first trade, the change in its value over that month.
// Together they add up to the current value. Months without a change have none.
export function getMarketValueChanges({
  securities,
  trades,
  prices,
  splits = [],
  today,
}: {
  securities: Array<
    Pick<SecurityEntity, 'id' | 'symbol' | 'name' | 'currency'>
  >;
  trades: Array<
    Pick<
      TradeEntity,
      'security' | 'date' | 'type' | 'quantity' | 'price' | 'fee'
    >
  >;
  prices: Array<Pick<SecurityPriceEntity, 'security' | 'date' | 'close'>>;
  splits?: Array<Pick<SecuritySplitEntity, 'security' | 'date' | 'ratio'>>;
  today: string;
}): MarketValueChange[] {
  return securities.flatMap(security => {
    const securityTrades = trades.filter(
      trade => trade.security === security.id,
    );
    const firstDate = securityTrades.map(trade => trade.date).sort()[0];
    if (firstDate == null || firstDate > today) {
      return [];
    }
    const securityPrices = prices.filter(
      price => price.security === security.id,
    );

    const holdingOn = (day: string) => {
      const latestPrice = securityPrices
        .filter(price => price.date <= day)
        .reduce<(typeof prices)[number] | undefined>(
          (latest, price) =>
            latest == null || price.date > latest.date ? price : latest,
          undefined,
        );
      return calculateHolding(
        security,
        securityTrades.filter(trade => trade.date <= day),
        latestPrice,
        splits.filter(
          split => split.security === security.id && split.date <= day,
        ),
      );
    };

    let previousValue = 0;
    return monthUtils
      .rangeInclusive(
        monthUtils.monthFromDate(firstDate),
        monthUtils.monthFromDate(today),
      )
      .flatMap(month => {
        const lastDay = monthUtils.lastDayOfMonth(month);
        const date = lastDay < today ? lastDay : today;
        const { marketValue, quantity, price } = holdingOn(date);
        const amount = marketValue - previousValue;
        previousValue = marketValue;
        return amount === 0
          ? []
          : [{ security: security.id, month, date, amount, quantity, price }];
      });
  });
}

// The latest day a close can be expected for: closes come out after trading
// ends, and there is no trading on weekends
export function getLatestClosingDay(today: string): string {
  let day = monthUtils.subDays(today, 1);
  while ([0, 6].includes(monthUtils.parseDate(day).getDay())) {
    day = monthUtils.subDays(day, 1);
  }
  return day;
}

// The days of closes to fetch for a security, or null if it has what it needs.
// Sold out securities only need closes up to the last trade, for the past value
// of the account.
export function getPriceFetchRange({
  firstTrade,
  lastTrade,
  earliestFetched,
  latestFetched,
  isHeld,
  today,
}: {
  firstTrade: string;
  lastTrade: string;
  earliestFetched: string | null;
  latestFetched: string | null;
  isHeld: boolean;
  today: string;
}): { start: string; end: string } | null {
  const end = isHeld || lastTrade > today ? today : lastTrade;

  if (latestFetched == null) {
    return { start: firstTrade, end };
  }

  // A backdated trade can need older closes. Only months count, since the first
  // close kept is usually days after the first trade.
  if (
    earliestFetched != null &&
    monthUtils.monthFromDate(firstTrade) <
      monthUtils.monthFromDate(earliestFetched)
  ) {
    return { start: firstTrade, end };
  }

  const isUpToDate =
    latestFetched >= (isHeld ? getLatestClosingDay(today) : end);
  return isUpToDate
    ? null
    : { start: monthUtils.addDays(latestFetched, 1), end };
}

// Keeps what valuing the account needs of a long history: the last close of each
// month, and every close of recent days. This saves syncing thousands of rows
// across devices when an account with years of trades is first fetched.
export function selectPricesToStore<T extends { date: string }>(
  prices: T[],
  today: string,
): T[] {
  const recentFrom = monthUtils.subDays(today, RECENT_PRICE_DAYS);
  const lastOfMonth = new Map<string, string>();
  for (const { date } of prices) {
    const month = monthUtils.monthFromDate(date);
    const last = lastOfMonth.get(month);
    if (last == null || date > last) {
      lastOfMonth.set(month, date);
    }
  }
  return prices.filter(
    ({ date }) =>
      date >= recentFrom ||
      lastOfMonth.get(monthUtils.monthFromDate(date)) === date,
  );
}
