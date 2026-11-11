import * as db from '#server/db';
import { getPerformanceHistory } from '#shared/investments';
import { currentDay } from '#shared/months';
import type { InvestmentPerformance } from '#types/models';

// An account's gain on cost at the end of each month since its first trade
export async function getInvestmentPerformance({
  account,
}: {
  account: db.DbAccount['id'];
}): Promise<InvestmentPerformance> {
  const [trades, securities, prices, splits] = await Promise.all([
    db.all<db.DbTrade>(
      'SELECT * FROM trades WHERE account = ? AND tombstone = 0',
      [account],
    ),
    db.all<db.DbSecurity>(
      `SELECT * FROM securities WHERE id IN (
         SELECT security FROM trades WHERE account = ? AND tombstone = 0
       ) ORDER BY symbol`,
      [account],
    ),
    db.all<db.DbSecurityPrice>(
      `SELECT * FROM security_prices WHERE tombstone = 0 AND security IN (
         SELECT security FROM trades WHERE account = ? AND tombstone = 0
       )`,
      [account],
    ),
    db.all<db.DbSecuritySplit>(
      `SELECT * FROM security_splits
       WHERE tombstone = 0 AND status = 'confirmed' AND security IN (
         SELECT security FROM trades WHERE account = ? AND tombstone = 0
       )`,
      [account],
    ),
  ]);

  return {
    securities: securities.map(({ id, symbol }) => ({ id, symbol })),
    months: getPerformanceHistory({
      securities: securities.map(security => ({
        id: security.id,
        symbol: security.symbol,
        name: security.name ?? null,
        currency: security.currency,
      })),
      trades: trades.map(trade => ({
        ...trade,
        date: db.fromDateRepr(trade.date),
      })),
      prices: prices.map(price => ({
        ...price,
        date: db.fromDateRepr(price.date),
      })),
      splits: splits.map(split => ({
        ...split,
        date: db.fromDateRepr(split.date),
      })),
      today: currentDay(),
    }),
  };
}
