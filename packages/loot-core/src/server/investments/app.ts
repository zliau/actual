import { createApp } from '#server/app';
import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { undoable } from '#server/undo';
import {
  calculateHolding,
  getExchangeCurrency,
  getSecurityId,
  getTradeCashAmount,
  isSecurityExchange,
  isValidSymbol,
  normalizeSymbol,
  sellsMoreThanHeld,
} from '#shared/investments';
import { currentDay, isValidYearMonthDay } from '#shared/months';
import type {
  AccountHoldings,
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
  SecurityPriceSource,
  TradeEntity,
} from '#types/models';

import { updateMarketValue, updateMarketValueOfHolders } from './market-value';
import { getInvestmentPerformance } from './performance';
import {
  getSecurityClose,
  getSecurityPriceStatus,
  searchSecurities,
  updateSecurityPrices,
} from './prices';
import {
  deleteSecuritySplit,
  dismissSecuritySplit,
  fromDbSecuritySplit,
  getConfirmedSplits,
  getSecuritySplits,
  setSecuritySplit,
} from './splits';
import { storeSecurityPrice } from './store-price';

export type InvestmentsHandlers = {
  'securities-get': typeof getSecurities;
  'security-create': typeof createSecurity;
  'security-prices-get': typeof getSecurityPrices;
  'security-price-set': typeof setSecurityPrice;
  'security-price-delete': typeof deleteSecurityPrice;
  'security-splits-get': typeof getSecuritySplits;
  'security-split-set': typeof setSecuritySplit;
  'security-split-dismiss': typeof dismissSecuritySplit;
  'security-split-delete': typeof deleteSecuritySplit;
  'trades-get': typeof getTrades;
  'trade-create': typeof createTrade;
  'trade-update': typeof updateTrade;
  'trade-delete': typeof deleteTrade;
  'holdings-get': typeof getHoldings;
  'security-prices-update': typeof updateSecurityPrices;
  'security-prices-status': typeof getSecurityPriceStatus;
  'securities-search': typeof searchSecurities;
  'security-close-get': typeof getSecurityClose;
  'investment-performance-get': typeof getInvestmentPerformance;
};

export const app = createApp<InvestmentsHandlers>();
app.method('securities-get', getSecurities);
app.method('security-create', mutator(undoable(createSecurity)));
app.method('security-prices-get', getSecurityPrices);
app.method('security-price-set', mutator(undoable(setSecurityPrice)));
app.method('security-price-delete', mutator(undoable(deleteSecurityPrice)));
app.method('security-splits-get', getSecuritySplits);
app.method('security-split-set', mutator(undoable(setSecuritySplit)));
app.method('security-split-dismiss', mutator(undoable(dismissSecuritySplit)));
app.method('security-split-delete', mutator(undoable(deleteSecuritySplit)));
app.method('trades-get', getTrades);
app.method('trade-create', mutator(undoable(createTrade)));
app.method('trade-update', mutator(undoable(updateTrade)));
app.method('trade-delete', mutator(undoable(deleteTrade)));
app.method('holdings-get', getHoldings);
app.method('security-prices-update', mutator(updateSecurityPrices));
app.method('security-prices-status', getSecurityPriceStatus);
app.method('securities-search', searchSecurities);
app.method('security-close-get', getSecurityClose);
app.method('investment-performance-get', getInvestmentPerformance);

type TradeFields = Pick<
  TradeEntity,
  'date' | 'type' | 'quantity' | 'price' | 'fee' | 'withheld'
>;

function fromDbSecurity(row: db.DbSecurity): SecurityEntity {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    name: row.name ?? null,
    currency: row.currency,
  };
}

function fromDbSecurityPrice(row: db.DbSecurityPrice): SecurityPriceEntity {
  return {
    id: row.id,
    security: row.security,
    date: db.fromDateRepr(row.date),
    close: row.close,
    source: row.source,
  };
}

function fromDbTrade(row: db.DbTrade): TradeEntity {
  return {
    id: row.id,
    account: row.account,
    security: row.security,
    date: db.fromDateRepr(row.date),
    type: row.type,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    withheld: row.withheld ?? 0,
    transaction_id: row.transaction_id ?? null,
  };
}

async function getSecurities(): Promise<SecurityEntity[]> {
  const rows = await db.all<db.DbSecurity>(
    'SELECT * FROM securities WHERE tombstone = 0 ORDER BY symbol, exchange',
  );
  return rows.map(fromDbSecurity);
}

// Adds a security, or updates the name of the one already stored
async function createSecurity({
  symbol,
  exchange,
  name = null,
}: {
  symbol: string;
  exchange: SecurityExchange;
  name?: string | null | undefined;
}): Promise<SecurityEntity['id']> {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!isValidSymbol(normalizedSymbol)) {
    throw new ValidationError(`security has invalid symbol '${symbol}'`);
  }
  if (!isSecurityExchange(exchange)) {
    throw new ValidationError(
      `security has unknown exchange '${String(exchange)}'`,
    );
  }

  const id = getSecurityId(exchange, normalizedSymbol);
  const existing = await db.first<Pick<db.DbSecurity, 'id'>>(
    'SELECT id FROM securities WHERE id = ?',
    [id],
  );
  if (existing) {
    await db.update('securities', {
      id,
      tombstone: 0,
      ...(name !== null && { name }),
    });
    return id;
  }

  await db.insert('securities', {
    id,
    symbol: normalizedSymbol,
    exchange,
    name,
    currency: getExchangeCurrency(exchange),
    tombstone: 0,
  });
  return id;
}

async function getSecurity(id: SecurityEntity['id']) {
  const security = await db.first<db.DbSecurity>(
    'SELECT * FROM securities WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!security) {
    throw new ValidationError(`security '${id}' does not exist`);
  }
  return security;
}

async function getSecurityPrices({
  security,
}: Pick<SecurityPriceEntity, 'security'>): Promise<SecurityPriceEntity[]> {
  const rows = await db.all<db.DbSecurityPrice>(
    `SELECT * FROM security_prices WHERE tombstone = 0 AND security = ?
     ORDER BY date DESC`,
    [security],
  );
  return rows.map(fromDbSecurityPrice);
}

async function setSecurityPrice({
  security,
  date,
  close,
  source = 'manual',
}: Pick<SecurityPriceEntity, 'security' | 'date' | 'close'> & {
  source?: SecurityPriceSource | undefined;
}): Promise<SecurityPriceEntity['id']> {
  await getSecurity(security);
  validateDate('security price', date);
  validatePositive('security price', close);

  const id = await storeSecurityPrice({ security, date, close, source });
  await updateMarketValueOfHolders(security);
  return id;
}

async function deleteSecurityPrice({
  id,
}: Pick<SecurityPriceEntity, 'id'>): Promise<void> {
  const price = await db.first<Pick<db.DbSecurityPrice, 'security'>>(
    'SELECT security FROM security_prices WHERE id = ?',
    [id],
  );
  await db.delete_('security_prices', id);
  if (price) {
    await updateMarketValueOfHolders(price.security);
  }
}

// Trades of deleted accounts are left out, since their transactions are gone
async function getTrades({
  account,
  security,
}: Partial<Pick<TradeEntity, 'account' | 'security'>> = {}): Promise<
  TradeEntity[]
> {
  const conditions = ['t.tombstone = 0', 'a.tombstone = 0'];
  const params: string[] = [];
  if (account !== undefined) {
    conditions.push('t.account = ?');
    params.push(account);
  }
  if (security !== undefined) {
    conditions.push('t.security = ?');
    params.push(security);
  }

  const rows = await db.all<db.DbTrade>(
    `SELECT t.* FROM trades t
     JOIN accounts a ON a.id = t.account
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.date DESC, t.id`,
    params,
  );
  return rows.map(fromDbTrade);
}

async function createTrade({
  account,
  security,
  date,
  type,
  quantity,
  price,
  fee = 0,
  withheld = 0,
}: Pick<TradeEntity, 'account' | 'security'> &
  Omit<TradeFields, 'fee' | 'withheld'> & {
    fee?: number | undefined;
    withheld?: number | undefined;
  }): Promise<TradeEntity['id']> {
  const fields = { date, type, quantity, price, fee, withheld };
  validateTradeFields(fields);

  const [dbAccount, dbSecurity] = await Promise.all([
    getOpenInvestmentAccount(account),
    getSecurity(security),
  ]);
  if (dbAccount.currency !== dbSecurity.currency) {
    throw new ValidationError(
      `trade of a ${dbSecurity.currency} security needs a ${dbSecurity.currency} account`,
    );
  }

  const existing = await getTrades({ account, security });
  const splits = await getConfirmedSplits(security);
  if (sellsMoreThanHeld([...existing, fields], splits)) {
    throw new ValidationError('trade sells more shares than are held');
  }

  let id = '';
  await batchMessages(async () => {
    const transactionId = await db.insertTransaction(
      getTransactionFields(account, dbSecurity, fields),
    );
    id = await db.insertWithUUID('trades', {
      account,
      security,
      date: db.toDateRepr(date),
      type,
      quantity,
      price,
      fee,
      withheld,
      transaction_id: transactionId,
      tombstone: 0,
    });
  });
  await updateMarketValue(account);
  return id;
}

async function updateTrade({
  id,
  ...changes
}: Pick<TradeEntity, 'id'> & Partial<TradeFields>): Promise<void> {
  const trade = await getStoredTrade(id);
  const type = changes.type ?? trade.type;
  const fields: TradeFields = {
    date: changes.date ?? trade.date,
    type,
    quantity: changes.quantity ?? trade.quantity,
    price: changes.price ?? trade.price,
    // Only buys and sells have a fee, and only vests withhold shares
    fee: type === 'vest' ? 0 : (changes.fee ?? trade.fee),
    withheld: type === 'vest' ? (changes.withheld ?? trade.withheld) : 0,
  };
  validateTradeFields(fields);

  const others = await getOtherTrades(trade);
  const splits = await getConfirmedSplits(trade.security);
  if (sellsMoreThanHeld([...others, fields], splits)) {
    throw new ValidationError('trade sells more shares than are held');
  }

  const dbSecurity = await getSecurity(trade.security);
  const transaction = getTransactionFields(trade.account, dbSecurity, fields);
  const linked =
    trade.transaction_id &&
    (await db.first<Pick<db.DbTransaction, 'id'>>(
      'SELECT id FROM transactions WHERE id = ? AND tombstone = 0',
      [trade.transaction_id],
    ));

  await batchMessages(async () => {
    let transactionId = trade.transaction_id;
    if (linked) {
      await db.updateTransaction({ id: linked.id, ...transaction });
    } else {
      // The transaction was deleted from the account, so bring the cash back
      transactionId = await db.insertTransaction(transaction);
    }
    await db.update('trades', {
      id,
      ...fields,
      date: db.toDateRepr(fields.date),
      transaction_id: transactionId,
    });
  });
  await updateMarketValue(trade.account);
}

async function deleteTrade({ id }: Pick<TradeEntity, 'id'>): Promise<void> {
  const trade = await getStoredTrade(id);

  const others = await getOtherTrades(trade);
  const splits = await getConfirmedSplits(trade.security);
  if (sellsMoreThanHeld(others, splits)) {
    throw new ValidationError(
      'deleting this trade would leave later sells with more shares than are held',
    );
  }

  await batchMessages(async () => {
    if (trade.transaction_id) {
      await db.deleteTransaction({ id: trade.transaction_id });
    }
    await db.delete_('trades', id);
  });
  await updateMarketValue(trade.account);
}

// Every security the account has traded, sold out ones included since their
// realized gains still count
async function getHoldings({
  account,
}: {
  account: TradeEntity['account'];
}): Promise<AccountHoldings> {
  const [trades, securities, latestPrices, balance, splits] = await Promise.all(
    [
      getTrades({ account }),
      db.all<db.DbSecurity>('SELECT * FROM securities'),
      // SQLite takes the other columns from the row with the latest date
      db.all<Pick<db.DbSecurityPrice, 'security' | 'date' | 'close'>>(
        `SELECT security, MAX(date) AS date, close FROM security_prices
       WHERE tombstone = 0 AND date <= ?
       GROUP BY security`,
        [db.toDateRepr(currentDay())],
      ),
      db.first<{ cash: number | null }>(
        `SELECT SUM(amount) AS cash FROM transactions
       WHERE acct = ? AND isParent = 0 AND tombstone = 0
         AND IFNULL(investment_type, '') != 'market-value'`,
        [account],
      ),
      db.all<db.DbSecuritySplit>(
        `SELECT * FROM security_splits
       WHERE tombstone = 0 AND status != 'dismissed' AND date <= ?
       ORDER BY date`,
        [db.toDateRepr(currentDay())],
      ),
    ],
  );
  const allSplits = splits.map(fromDbSecuritySplit);

  const holdings = securities.flatMap(security => {
    const securityTrades = trades.filter(
      trade => trade.security === security.id,
    );
    if (securityTrades.length === 0) {
      return [];
    }
    const latest = latestPrices.find(price => price.security === security.id);
    return [
      calculateHolding(
        fromDbSecurity(security),
        securityTrades,
        latest && { date: db.fromDateRepr(latest.date), close: latest.close },
        allSplits.filter(
          split =>
            split.security === security.id && split.status === 'confirmed',
        ),
      ),
    ];
  });

  return {
    holdings: holdings.sort(
      (a, b) =>
        Number(b.quantity > 0) - Number(a.quantity > 0) ||
        a.symbol.localeCompare(b.symbol),
    ),
    cash: balance?.cash ?? 0,
    suggestedSplits: allSplits.flatMap(split => {
      const holding = holdings.find(
        ({ security }) => security === split.security,
      );
      return split.status === 'suggested' && holding
        ? [{ ...split, symbol: holding.symbol }]
        : [];
    }),
  };
}

async function getStoredTrade(id: TradeEntity['id']): Promise<TradeEntity> {
  const row = await db.first<db.DbTrade>(
    'SELECT * FROM trades WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!row) {
    throw new ValidationError(`trade '${id}' does not exist`);
  }
  return fromDbTrade(row);
}

async function getOtherTrades(trade: TradeEntity) {
  const trades = await getTrades({
    account: trade.account,
    security: trade.security,
  });
  return trades.filter(other => other.id !== trade.id);
}

async function getOpenInvestmentAccount(id: TradeEntity['account']) {
  const account = await db.first<db.DbAccount>(
    'SELECT * FROM accounts WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!account?.investment) {
    throw new ValidationError(`account '${id}' is not an investment account`);
  }
  if (account.closed) {
    throw new ValidationError(`account '${id}' is closed`);
  }
  return account;
}

function getTransactionFields(
  account: TradeEntity['account'],
  security: db.DbSecurity,
  fields: TradeFields,
) {
  const label = { buy: 'Buy', sell: 'Sell', vest: 'Vest' }[fields.type];
  const withheld =
    fields.withheld > 0 ? `, ${fields.withheld} withheld for tax` : '';
  return {
    account,
    amount: getTradeCashAmount(fields),
    date: fields.date,
    notes: `${label} ${fields.quantity} ${security.symbol} @ ${fields.price}${withheld}`,
    cleared: true,
    investment_type: 'trade',
  };
}

function validateTradeFields({
  date,
  type,
  quantity,
  price,
  fee,
  withheld,
}: TradeFields) {
  validateDate('trade', date);
  if (type !== 'buy' && type !== 'sell' && type !== 'vest') {
    throw new ValidationError(`trade has unknown type '${String(type)}'`);
  }
  validatePositive('trade quantity', quantity);
  validatePositive('trade price', price);
  if (!Number.isInteger(fee) || fee < 0) {
    throw new ValidationError('trade fee must be a whole number of cents');
  }
  if (type === 'vest' && fee !== 0) {
    throw new ValidationError('vest has no fee');
  }
  if (!Number.isFinite(withheld) || withheld < 0) {
    throw new ValidationError('trade withheld shares must be zero or more');
  }
  if (type !== 'vest' && withheld !== 0) {
    throw new ValidationError('only a vest withholds shares');
  }
}

function validateDate(name: string, date: string) {
  if (!isValidYearMonthDay(date)) {
    throw new ValidationError(`${name} has invalid date '${date}'`);
  }
}

function validatePositive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive number`);
  }
}
