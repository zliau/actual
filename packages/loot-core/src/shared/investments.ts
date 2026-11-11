import type {
  Holding,
  PerformanceMonth,
  PerformancePoint,
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

    const holdingOn = (day: string) =>
      getHoldingOn({
        security,
        trades: securityTrades,
        prices: securityPrices,
        splits,
        day,
      });

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

// A security's position at the end of a day, from the trades, closes and
// splits up to then
function getHoldingOn({
  security,
  trades,
  prices,
  splits,
  day,
}: {
  security: Pick<SecurityEntity, 'id' | 'symbol' | 'name' | 'currency'>;
  trades: Array<
    Pick<
      TradeEntity,
      'security' | 'date' | 'type' | 'quantity' | 'price' | 'fee'
    >
  >;
  prices: Array<Pick<SecurityPriceEntity, 'security' | 'date' | 'close'>>;
  splits: Array<Pick<SecuritySplitEntity, 'security' | 'date' | 'ratio'>>;
  day: string;
}): Holding {
  const latestPrice = prices
    .filter(price => price.security === security.id && price.date <= day)
    .reduce<(typeof prices)[number] | undefined>(
      (latest, price) =>
        latest == null || price.date > latest.date ? price : latest,
      undefined,
    );
  return calculateHolding(
    security,
    trades.filter(trade => trade.security === security.id && trade.date <= day),
    latestPrice,
    splits.filter(split => split.security === security.id && split.date <= day),
  );
}

type PerformanceTrade = Pick<
  TradeEntity,
  'security' | 'date' | 'type' | 'quantity' | 'price' | 'fee'
>;

// A security on one day of the performance history, in cents
type DaySnapshot = {
  // Whether the security has been bought by then
  isHeld: boolean;
  // What was held before the day's trades, valued at the latest close
  open: number;
  // Each of the day's trades in order, with what was held just before and just
  // after it, both valued at its price
  trades: Array<{
    before: number;
    after: number;
    buyFee: number;
    sellFee: number;
  }>;
  // What was held at the end of the day, valued at the latest close
  close: number;
  // Cash put in by buys, less cash taken out by sells, fees included
  netFlow: number;
};

// A security's snapshot on each of the days, which must be oldest first. One
// pass through its splits, trades and closes in date order: on a day, a split
// comes first as it takes effect before the market opens, and the close last.
function getDaySnapshots(
  days: string[],
  trades: PerformanceTrade[],
  prices: Array<Pick<SecurityPriceEntity, 'date' | 'close'>>,
  splits: Split[],
): DaySnapshot[] {
  type Event =
    | { kind: 'split'; date: string; ratio: number }
    | { kind: 'trade'; date: string; trade: PerformanceTrade }
    | { kind: 'close'; date: string; close: number };
  const order = (event: Event) =>
    event.kind === 'split'
      ? 0
      : event.kind === 'close'
        ? 3
        : event.trade.type === 'buy'
          ? 1
          : 2;
  const events: Event[] = [
    ...splits.map(({ date, ratio }) => ({
      kind: 'split' as const,
      date,
      ratio,
    })),
    ...trades.map(trade => ({
      kind: 'trade' as const,
      date: trade.date,
      trade,
    })),
    ...prices.map(({ date, close }) => ({
      kind: 'close' as const,
      date,
      close,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));

  let index = 0;
  let quantity = 0;
  let price = 0;
  let isHeld = false;
  const valueAt = (perShare: number) => amountToInteger(quantity * perShare);

  return days.map(day => {
    const snapshot: DaySnapshot = {
      isHeld,
      open: 0,
      trades: [],
      close: 0,
      netFlow: 0,
    };
    let isOpen = false;
    while (index < events.length && events[index].date <= day) {
      const event = events[index];
      index += 1;
      if (event.kind !== 'split' && event.date === day && !isOpen) {
        snapshot.open = valueAt(price);
        isOpen = true;
      }
      if (event.kind === 'split') {
        quantity *= event.ratio;
        price /= event.ratio;
      } else if (event.kind === 'close') {
        price = event.close;
      } else {
        const { trade } = event;
        const before = valueAt(trade.price);
        const value = amountToInteger(trade.quantity * trade.price);
        if (trade.type === 'buy') {
          quantity += trade.quantity;
          isHeld = true;
          snapshot.netFlow += value + trade.fee;
        } else {
          const remaining = quantity - trade.quantity;
          quantity = remaining < SHARE_EPSILON ? 0 : remaining;
          snapshot.netFlow -= value - trade.fee;
        }
        price = trade.price;
        snapshot.trades.push({
          before,
          after: valueAt(trade.price),
          buyFee: trade.type === 'buy' ? trade.fee : 0,
          sellFee: trade.type === 'buy' ? 0 : trade.fee,
        });
      }
    }
    snapshot.isHeld = isHeld;
    snapshot.close = valueAt(price);
    if (!isOpen) {
      snapshot.open = snapshot.close;
    }
    return snapshot;
  });
}

// The time-weighted growth from the first trade to each day, for some
// securities together: the time is cut at every trade, and the returns of the
// pieces in between are multiplied, so that money put in or taken out doesn't
// count as a gain or loss. 1.1 means up 10%. Fees count as losses, and a trade
// at a price other than the previous one counts as a gain or loss on what was
// held. Within a day, only the traded security's price changes between its
// trades, as closes only come at the end of the day.
function getGrowth(snapshots: DaySnapshot[][], days: string[]): number[] {
  let growth = 1;
  // What was held at the previous day's close
  let start = 0;
  return days.map((_, day) => {
    // Each security's value at its latest price so far today
    const values = snapshots.map(security => security[day].open);
    let total = values.reduce((sum, value) => sum + value, 0);
    let base = start;
    snapshots.forEach((security, index) => {
      for (const trade of security[day].trades) {
        const before = total - values[index] + trade.before - trade.sellFee;
        if (base > 0) {
          growth *= before / base;
        }
        total += trade.after - values[index];
        values[index] = trade.after;
        base = total + trade.buyFee;
      }
    });
    const close = snapshots.reduce(
      (sum, security) => sum + security[day].close,
      0,
    );
    if (base > 0) {
      growth *= close / base;
    }
    start = close;
    return growth;
  });
}

// For each month from the first trade to today, the value at its end, the gain
// over it, and the time-weighted growth since the first trade: of each security
// and of all of them together. The month's end is today for the current month.
export function getPerformanceHistory({
  securities,
  trades,
  prices,
  splits = [],
  today,
}: {
  securities: Array<Pick<SecurityEntity, 'id'>>;
  trades: PerformanceTrade[];
  prices: Array<Pick<SecurityPriceEntity, 'security' | 'date' | 'close'>>;
  splits?: Array<Pick<SecuritySplitEntity, 'security' | 'date' | 'ratio'>>;
  today: string;
}): PerformanceMonth[] {
  const pastTrades = trades.filter(trade => trade.date <= today);
  const firstDate = pastTrades.map(trade => trade.date).sort()[0];
  if (firstDate == null) {
    return [];
  }

  const months = monthUtils
    .rangeInclusive(
      monthUtils.monthFromDate(firstDate),
      monthUtils.monthFromDate(today),
    )
    .map(month => {
      const lastDay = monthUtils.lastDayOfMonth(month);
      return { month, date: lastDay < today ? lastDay : today };
    });
  // Every month end and trading day, oldest first
  const days = [
    ...new Set([
      ...months.map(({ date }) => date),
      ...pastTrades.map(trade => trade.date),
    ]),
  ].sort();
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const snapshots = securities.map(security =>
    getDaySnapshots(
      days,
      pastTrades.filter(trade => trade.security === security.id),
      prices.filter(price => price.security === security.id),
      splits.filter(split => split.security === security.id),
    ),
  );

  // The month-end points of some securities together
  const getPoints = (included: DaySnapshot[][]): PerformancePoint[] => {
    const growth = getGrowth(included, days);
    let previousGain = 0;
    let netFlow = 0;
    let dayIndexDone = 0;
    return months.map(({ date }) => {
      const end = dayIndex.get(date) ?? 0;
      for (; dayIndexDone <= end; dayIndexDone++) {
        for (const security of included) {
          netFlow += security[dayIndexDone].netFlow;
        }
      }
      const value = included.reduce(
        (sum, security) => sum + security[end].close,
        0,
      );
      // Everything gained so far is the value less the cash put in
      const gainSoFar = value - netFlow;
      const gain = gainSoFar - previousGain;
      previousGain = gainSoFar;
      return { value, gain, growth: growth[end] };
    });
  };

  const totals = getPoints(snapshots);
  const bySecurity = securities.map((security, index) => ({
    id: security.id,
    snapshots: snapshots[index],
    points: getPoints([snapshots[index]]),
  }));

  return months.map(({ month, date }, index) => {
    const end = dayIndex.get(date) ?? 0;
    return {
      month,
      date,
      total: totals[index],
      securities: Object.fromEntries(
        bySecurity
          .filter(({ snapshots }) => snapshots[end].isHeld)
          .map(({ id, points }) => [id, points[index]]),
      ),
    };
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
