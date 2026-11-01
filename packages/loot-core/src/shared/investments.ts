import type {
  Holding,
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
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

// Oldest first, with buys on a day before sells on the same day
function sortTrades<T extends Pick<TradeEntity, 'date' | 'type'>>(
  trades: T[],
): T[] {
  return [...trades].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.type === 'sell') - Number(b.type === 'sell'),
  );
}

// Whether a security's trades ever sell more shares than are held at that
// point. Buys on a day count before sells on the same day.
export function sellsMoreThanHeld(
  trades: Array<Pick<TradeEntity, 'date' | 'type' | 'quantity'>>,
): boolean {
  let held = 0;
  for (const trade of sortTrades(trades)) {
    held += trade.type === 'buy' ? trade.quantity : -trade.quantity;
    if (held < -SHARE_EPSILON) {
      return true;
    }
  }
  return false;
}

// Works out a position from all of a security's trades, using average cost: a
// buy adds its value and fee to the cost, and a sell takes out its share of the
// cost at the average. The price is the latest close, or the latest trade's
// price when that is newer.
export function calculateHolding(
  security: Pick<SecurityEntity, 'id' | 'symbol' | 'name' | 'currency'>,
  trades: Array<
    Pick<TradeEntity, 'date' | 'type' | 'quantity' | 'price' | 'fee'>
  >,
  latestPrice?: Pick<SecurityPriceEntity, 'date' | 'close'>,
): Holding {
  const sorted = sortTrades(trades);

  let quantity = 0;
  let costBasis = 0;
  let realizedGain = 0;
  for (const trade of sorted) {
    const value = amountToInteger(trade.quantity * trade.price);
    if (trade.type === 'buy') {
      quantity += trade.quantity;
      costBasis += value + trade.fee;
    } else {
      const remaining = quantity - trade.quantity;
      const isSoldOut = remaining < SHARE_EPSILON;
      const costSold = isSoldOut
        ? costBasis
        : Math.round((costBasis * trade.quantity) / quantity);
      realizedGain += value - trade.fee - costSold;
      costBasis -= costSold;
      quantity = isSoldOut ? 0 : remaining;
    }
  }

  const lastTrade = sorted[sorted.length - 1];
  const isCloseCurrent =
    latestPrice != null &&
    (lastTrade == null || latestPrice.date >= lastTrade.date);
  const price = isCloseCurrent ? latestPrice.close : (lastTrade?.price ?? 0);
  const priceDate = isCloseCurrent ? latestPrice.date : (lastTrade?.date ?? '');

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
