import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { getMarketValueChanges, SHARE_EPSILON } from '#shared/investments';
import type { MarketValueChange } from '#shared/investments';
import { currentDay } from '#shared/months';

// Brings an account's market value transactions in line with its trades and
// prices, so its balance is its cash plus the value of its holdings. A closed
// account is left alone, since its balance has been moved out.
export async function updateMarketValue(account: db.DbAccount['id']) {
  const dbAccount = await db.first<db.DbAccount>(
    'SELECT * FROM accounts WHERE id = ? AND tombstone = 0',
    [account],
  );
  if (!dbAccount?.investment || dbAccount.closed) {
    return;
  }

  const [trades, securities, prices, existing] = await Promise.all([
    db.all<db.DbTrade>(
      'SELECT * FROM trades WHERE account = ? AND tombstone = 0',
      [account],
    ),
    db.all<db.DbSecurity>(
      `SELECT * FROM securities WHERE id IN (
         SELECT security FROM trades WHERE account = ? AND tombstone = 0
       )`,
      [account],
    ),
    db.all<db.DbSecurityPrice>(
      `SELECT * FROM security_prices WHERE tombstone = 0 AND security IN (
         SELECT security FROM trades WHERE account = ? AND tombstone = 0
       )`,
      [account],
    ),
    db.all<
      Pick<db.DbTransaction, 'id' | 'amount' | 'date' | 'notes' | 'tombstone'>
    >(
      `SELECT id, amount, date, notes, tombstone FROM transactions
       WHERE acct = ? AND investment_type = 'market-value'`,
      [account],
    ),
  ]);

  const changes = getMarketValueChanges({
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
    today: currentDay(),
  });

  // The id comes from the account, security and month so devices working this
  // out while they can't sync end up with one transaction for each. Older
  // transactions for all securities at once don't match one, so they go.
  const symbols = new Map(
    securities.map(security => [security.id, security.symbol]),
  );
  const wanted = new Map(
    changes.map(change => [
      `market-value-${account}-${change.security}-${change.month}`,
      {
        date: change.date,
        amount: change.amount,
        notes: getMarketValueNotes(
          symbols.get(change.security) ?? change.security,
          change,
        ),
      },
    ]),
  );
  const existingById = new Map(existing.map(row => [row.id, row]));

  await batchMessages(async () => {
    for (const row of existing) {
      if (!row.tombstone && !wanted.has(row.id)) {
        await db.deleteTransaction({ id: row.id });
      }
    }

    for (const [id, { date, amount, notes }] of wanted) {
      const row = existingById.get(id);
      if (!row) {
        await db.insertTransaction({
          id,
          account,
          amount,
          date,
          notes,
          cleared: true,
          investment_type: 'market-value',
        });
      } else if (
        row.tombstone ||
        row.amount !== amount ||
        row.date !== db.toDateRepr(date) ||
        row.notes !== notes
      ) {
        await db.updateTransaction({
          id,
          amount,
          date,
          notes,
          tombstone: false,
        });
      }
    }
  });
}

// Says which security a market value transaction is for, and what it was worth
// at the end of the month, like the notes of a trade: `Market value 10 AAPL @
// 120`
function getMarketValueNotes(
  symbol: string,
  { quantity, price }: Pick<MarketValueChange, 'quantity' | 'price'>,
) {
  if (quantity < SHARE_EPSILON) {
    return `Market value ${symbol}, sold`;
  }
  // Rounded so float error and long prices don't show
  const shares = Number(quantity.toFixed(6));
  const sharePrice = Number(price.toFixed(4));
  return `Market value ${shares} ${symbol} @ ${sharePrice}`;
}

// Prices change the value of every open account holding the security
export async function updateMarketValueOfHolders(
  security: db.DbSecurity['id'],
) {
  const holders = await db.all<Pick<db.DbTrade, 'account'>>(
    'SELECT DISTINCT account FROM trades WHERE security = ? AND tombstone = 0',
    [security],
  );
  for (const { account } of holders) {
    await updateMarketValue(account);
  }
}
