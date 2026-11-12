import type {
  Holding,
  PerformanceMonth,
  PerformancePoint,
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
  SecuritySplitEntity,
  TradeEntity,
  TradeType,
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

// How a trade changes the shares held: buys, vests, reinvested dividends and
// moves in bring shares in, sells and moves out take them out, and cash paid
// out leaves them as they are
export function getShareChange(type: TradeType): 1 | -1 | 0 {
  switch (type) {
    case 'buy':
    case 'vest':
    case 'reinvested-dividend':
    case 'move-in':
      return 1;
    case 'sell':
    case 'move-out':
      return -1;
    default:
      return 0;
  }
}

// Whether a trade brings shares in
export function addsShares(type: TradeType): boolean {
  return getShareChange(type) === 1;
}

// Whether a trade is only cash a security paid out, without shares or a price
export function isCashOnly(type: TradeType): boolean {
  return type === 'dividend' || type === 'return-of-capital';
}

// Whether a trade moves shares between two of the user's accounts
export function isMove(type: TradeType): boolean {
  return type === 'move-in' || type === 'move-out';
}

// The change in the account's cash, in cents. A buy costs the shares plus the
// fee, a sell brings in the shares less the fee, and a dividend brings in what
// it paid. A vest's shares are pay and moved shares were already the user's,
// so no cash moves for them.
export function getTradeCashAmount({
  type,
  quantity,
  price,
  fee,
  amount = 0,
}: Pick<TradeEntity, 'type' | 'quantity' | 'price' | 'fee'> & {
  amount?: number;
}): number {
  const value = amountToInteger(quantity * price);
  switch (type) {
    case 'buy':
      return -(value + fee);
    case 'sell':
      return value - fee;
    case 'dividend':
    case 'return-of-capital':
      return amount;
    default:
      return 0;
  }
}

type Split = Pick<SecuritySplitEntity, 'date' | 'ratio'>;

// Oldest first. A split takes effect before the market opens, so on its day it
// comes before any trade. Shares coming in come before those going out, and
// dividends come last.
function sortEvents<T extends Pick<TradeEntity, 'date' | 'type'>>(
  trades: T[],
  splits: Split[],
): Array<(T & { kind: 'trade' }) | (Split & { kind: 'split' })> {
  const order = (event: { kind: string; type?: TradeType }) =>
    event.type == null
      ? 0
      : ({ 1: 1, '-1': 2, 0: 3 } as const)[getShareChange(event.type)];
  return [
    ...trades.map(trade => ({ ...trade, kind: 'trade' as const })),
    ...splits.map(split => ({ ...split, kind: 'split' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
}

// Whether a security's trades ever take out more shares than are held at that
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
      held += getShareChange(event.type) * event.quantity;
    }
    if (held < -SHARE_EPSILON) {
      return true;
    }
  }
  return false;
}

// A trade for working out a position. A move in carries the cost the shares
// had in the account they left, in cents. Without it, as when that account was
// deleted, they cost what they were worth on the day of the move.
export type HoldingTrade = Pick<
  TradeEntity,
  'date' | 'type' | 'quantity' | 'price' | 'fee'
> & {
  id?: TradeEntity['id'];
  amount?: number;
  cost?: number;
};

type Position = {
  quantity: number;
  costBasis: number;
  realizedGain: number;
  dividends: number;
  // The latest trade with a price, for valuing the shares without a close
  lastPricedTrade: HoldingTrade | undefined;
};

type PositionEvent = ReturnType<typeof sortEvents<HoldingTrade>>[number];

function getEmptyPosition(): Position {
  return {
    quantity: 0,
    costBasis: 0,
    realizedGain: 0,
    dividends: 0,
    lastPricedTrade: undefined,
  };
}

// Goes through a security's trades in order, using average cost: shares coming
// in add what they cost, and shares going out take out their share of the cost
// at the average. Only a sell realizes a gain. A split changes the shares but
// not the cost.
function getPosition(trades: HoldingTrade[], splits: Split[]): Position {
  const position = getEmptyPosition();
  for (const event of sortEvents(trades, splits)) {
    applyEvent(position, event);
  }
  return position;
}

// Adds one event to a position. Returns the cost that shares going out took
// with them, in cents.
function applyEvent(position: Position, event: PositionEvent): number {
  if (event.kind === 'split') {
    position.quantity *= event.ratio;
    return 0;
  }
  if (event.type === 'dividend') {
    position.dividends += event.amount ?? 0;
    return 0;
  }
  if (event.type === 'return-of-capital') {
    // Lowers the cost, and once that reaches zero the rest is a gain
    const amount = event.amount ?? 0;
    const costLeft = position.costBasis - amount;
    position.realizedGain += Math.max(0, -costLeft);
    position.costBasis = Math.max(0, costLeft);
    return 0;
  }
  position.lastPricedTrade = event;
  const value = amountToInteger(event.quantity * event.price);
  if (addsShares(event.type)) {
    position.quantity += event.quantity;
    // A vest's shares cost what they were worth that day, as that is the
    // pay, and reinvested ones cost the dividend that bought them. Moved
    // shares keep what they cost before.
    position.costBasis +=
      event.type === 'move-in' ? (event.cost ?? value) : value + event.fee;
    if (event.type === 'reinvested-dividend') {
      position.dividends += value;
    }
    return 0;
  }
  const remaining = position.quantity - event.quantity;
  const isAllGone = remaining < SHARE_EPSILON;
  const costOut = isAllGone
    ? position.costBasis
    : Math.round((position.costBasis * event.quantity) / position.quantity);
  if (event.type === 'sell') {
    position.realizedGain += value - event.fee - costOut;
  }
  position.costBasis -= costOut;
  position.quantity = isAllGone ? 0 : remaining;
  return costOut;
}

// The cost each move in carries, in cents, by trade id: what its shares cost
// in the account they left. Takes one security's trades across all accounts
// and goes through each account's in order, in step: an account waits at a
// move in until the account the shares come from reaches the move out, so
// shares moved back and forth any number of times keep their first cost.
// A move in whose other half is missing, as when its account was deleted, gets
// no cost, and so costs what the shares were worth on the day.
export function getMoveInCosts(
  trades: Array<
    HoldingTrade & Pick<TradeEntity, 'id' | 'account' | 'transfer_id'>
  >,
  splits: Split[] = [],
): Map<TradeEntity['id'], number> {
  const ids = new Set(trades.map(trade => trade.id));
  const costs = new Map<TradeEntity['id'], number>();
  // Move ins still waiting for their move out
  const pending = new Set(
    trades.flatMap(trade =>
      trade.type === 'move-in' &&
      trade.transfer_id &&
      ids.has(trade.transfer_id)
        ? [trade.id]
        : [],
    ),
  );

  const accounts = [...new Set(trades.map(trade => trade.account))].map(
    account => ({
      position: getEmptyPosition(),
      events: sortEvents(
        trades.filter(trade => trade.account === account),
        splits,
      ),
      next: 0,
    }),
  );

  const advance = (account: (typeof accounts)[number]) => {
    let moved = false;
    while (account.next < account.events.length) {
      const event = account.events[account.next];
      if (event.kind === 'trade' && pending.has(event.id)) {
        break;
      }
      const cost = applyEvent(
        account.position,
        event.kind === 'trade' && event.type === 'move-in'
          ? { ...event, cost: costs.get(event.id) }
          : event,
      );
      if (event.kind === 'trade' && event.type === 'move-out') {
        if (event.transfer_id && pending.delete(event.transfer_id)) {
          costs.set(event.transfer_id, cost);
        }
      }
      account.next++;
      moved = true;
    }
    return moved;
  };

  for (;;) {
    let moved = false;
    for (const account of accounts) {
      moved = advance(account) || moved;
    }
    if (pending.size === 0 && !moved) {
      break;
    }
    if (!moved) {
      // Moves on one day that go both ways wait for each other, since shares
      // coming in are counted before those going out. Let the first one in
      // through at what its shares were worth.
      const stuck = accounts.find(
        account => account.next < account.events.length,
      );
      const event = stuck?.events[stuck.next];
      if (event?.kind !== 'trade') {
        break;
      }
      pending.delete(event.id);
    }
  }
  return costs;
}

// Works out a position from all of a security's trades in an account. The
// price is the latest close, or the latest trade's price when that is newer,
// adjusted for any split since then.
export function calculateHolding(
  security: Pick<SecurityEntity, 'id' | 'symbol' | 'name' | 'currency'>,
  trades: HoldingTrade[],
  latestPrice?: Pick<SecurityPriceEntity, 'date' | 'close'>,
  splits: Split[] = [],
): Holding {
  const { quantity, costBasis, realizedGain, dividends, lastPricedTrade } =
    getPosition(trades, splits);

  const isCloseCurrent =
    latestPrice != null &&
    (lastPricedTrade == null || latestPrice.date >= lastPricedTrade.date);
  const priceDate = isCloseCurrent
    ? latestPrice.date
    : (lastPricedTrade?.date ?? '');
  // A price from before a split is for shares that have since been divided
  const laterSplits = splits.filter(split => split.date > priceDate);
  const price = laterSplits.reduce(
    (adjusted, split) => adjusted / split.ratio,
    isCloseCurrent ? latestPrice.close : (lastPricedTrade?.price ?? 0),
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
    dividends,
  };
}

export type MarketValueChange = {
  security: SecurityEntity['id'];
  month: string;
  date: string;
  // The change in value, in cents
  amount: number;
  // For a month: what was held at its end, and the price it was valued at.
  // For a trade: its shares and price.
  quantity: number;
  price: number;
  // Set when this is the value of the shares a trade brought in or took out
  trade?: Pick<TradeEntity, 'id' | 'type'>;
};

// What the account's market value transactions should be, for each security
// from its first trade. On the day of a trade, the value of the shares it
// brought in or took out at its price, so the balance doesn't dip between
// paying for shares and the end of the month. And for each month, the rest of
// the change in value over it, which is what prices did. Together they add up
// to the current value. Months without such a change have none.
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
      'id' | 'security' | 'date' | 'type' | 'quantity' | 'price' | 'fee'
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

    const tradeChanges = securityTrades
      .filter(trade => trade.date <= today)
      .map((trade): MarketValueChange => ({
        security: security.id,
        month: monthUtils.monthFromDate(trade.date),
        date: trade.date,
        amount:
          getShareChange(trade.type) *
          amountToInteger(trade.quantity * trade.price),
        quantity: trade.quantity,
        price: trade.price,
        trade: { id: trade.id, type: trade.type },
      }))
      .filter(change => change.amount !== 0)
      .sort((a, b) => a.date.localeCompare(b.date));

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
        const monthTrades = tradeChanges.filter(
          change => change.month === month,
        );
        const traded = monthTrades.reduce(
          (sum, change) => sum + change.amount,
          0,
        );
        const amount = marketValue - previousValue - traded;
        previousValue = marketValue;
        return [
          ...monthTrades,
          ...(amount === 0
            ? []
            : [
                { security: security.id, month, date, amount, quantity, price },
              ]),
        ];
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
> & { amount?: number };

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
  // Money put in by buys and vests, less cash taken out by sells, fees
  // included. A vest puts in its shares' value, as pay.
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
        ? 4
        : ({ 1: 1, '-1': 2, 0: 3 } as const)[getShareChange(event.trade.type)];
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
        if (isCashOnly(trade.type)) {
          // Paid out to the user, so a gain on what was held, valued at the
          // latest price
          const amount = trade.amount ?? 0;
          snapshot.netFlow -= amount;
          snapshot.trades.push({
            before: valueAt(price) + amount,
            after: valueAt(price),
            buyFee: 0,
            sellFee: 0,
          });
          continue;
        }
        const value = amountToInteger(trade.quantity * trade.price);
        if (trade.type === 'reinvested-dividend') {
          // Paid out and bought back in shares at once: a gain, with no money
          // put in
          const before = valueAt(trade.price) + value;
          quantity += trade.quantity;
          isHeld = true;
          price = trade.price;
          snapshot.trades.push({
            before,
            after: valueAt(trade.price),
            buyFee: 0,
            sellFee: 0,
          });
          continue;
        }
        const before = valueAt(trade.price);
        // A vest counts as money put in at the day's price, like a buy, and
        // shares moved in or out count as money put in or taken out at theirs
        if (addsShares(trade.type)) {
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
          buyFee: addsShares(trade.type) ? trade.fee : 0,
          sellFee: addsShares(trade.type) ? 0 : trade.fee,
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
// trades, as closes only come at the end of the day. A dividend paid once
// everything has been sold is a return on the shares that were sold, so it
// counts as if it had come with the sale.
function getGrowth(snapshots: DaySnapshot[][], days: string[]): number[] {
  let growth = 1;
  // What was held at the previous day's close
  let start = 0;
  // What was held just before the last sale that left nothing, with anything
  // paid out on it since
  let soldOut = 0;
  return days.map((_, day) => {
    // Each security's value at its latest price so far today
    const values = snapshots.map(security => security[day].open);
    let total = values.reduce((sum, value) => sum + value, 0);
    let base = start;
    snapshots.forEach((security, index) => {
      for (const trade of security[day].trades) {
        const before = total - values[index] + trade.before - trade.sellFee;
        const wasHeld = base > 0;
        if (wasHeld) {
          growth *= before / base;
        } else if (soldOut > 0 && before > 0) {
          growth *= (soldOut + before) / soldOut;
          soldOut += before;
        }
        total += trade.after - values[index];
        values[index] = trade.after;
        base = total + trade.buyFee;
        if (wasHeld && base <= 0) {
          soldOut = before;
        }
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
