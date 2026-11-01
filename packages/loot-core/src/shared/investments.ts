import type { SecurityExchange, TradeEntity } from '#types/models';

import { amountToInteger } from './util';

// Below this a position counts as fully sold, so rounding in fractional shares
// can't leave a tiny remainder or block selling everything.
export const SHARE_EPSILON = 0.000001;

const EXCHANGE_CURRENCIES: Record<SecurityExchange, string> = {
  US: 'USD',
  TSX: 'CAD',
};

export function isSecurityExchange(value: string): value is SecurityExchange {
  return Object.hasOwn(EXCHANGE_CURRENCIES, value);
}

export function getExchangeCurrency(exchange: SecurityExchange): string {
  return EXCHANGE_CURRENCIES[exchange];
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

// Whether a security's trades ever sell more shares than are held at that
// point. Buys on a day count before sells on the same day.
export function sellsMoreThanHeld(
  trades: Array<Pick<TradeEntity, 'date' | 'type' | 'quantity'>>,
): boolean {
  const sorted = [...trades].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.type === 'sell') - Number(b.type === 'sell'),
  );

  let held = 0;
  for (const trade of sorted) {
    held += trade.type === 'buy' ? trade.quantity : -trade.quantity;
    if (held < -SHARE_EPSILON) {
      return true;
    }
  }
  return false;
}
