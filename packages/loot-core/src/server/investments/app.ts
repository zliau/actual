import { createApp } from '#server/app';
import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { undoable } from '#server/undo';
import {
  calculateHolding,
  getExchangeCurrency,
  getMoveInCosts,
  getSecurityId,
  getTradeCashAmount,
  isCashOnly,
  isMove,
  isSecurityExchange,
  isValidSymbol,
  normalizeSymbol,
  sellsMoreThanHeld,
} from '#shared/investments';
import type { HoldingTrade } from '#shared/investments';
import { currentDay, isValidYearMonthDay } from '#shared/months';
import type {
  AccountHoldings,
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
  SecurityPriceSource,
  SecuritySplitEntity,
  TradeEntity,
  TradeType,
} from '#types/models';

import { answerDividendSuggestion, getSuggestedDividends } from './dividends';
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
  'dividend-suggestion-answer': typeof answerDividendSuggestion;
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
app.method(
  'dividend-suggestion-answer',
  mutator(undoable(answerDividendSuggestion)),
);
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
  'date' | 'type' | 'quantity' | 'price' | 'fee' | 'withheld' | 'amount'
>;

// Trades can change type within each of these groups: those with shares and a
// price, and cash paid out. A move stays a move.
const TRADE_TYPE_GROUPS: TradeType[][] = [
  ['buy', 'sell', 'vest', 'reinvested-dividend'],
  ['dividend', 'return-of-capital'],
];
const TRADE_TYPES: TradeType[] = [
  ...TRADE_TYPE_GROUPS.flat(),
  'move-in',
  'move-out',
];

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

function fromDbTrade(
  row: db.DbTrade & { transfer_account?: string | null },
): TradeEntity {
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
    amount: row.amount ?? 0,
    transfer_id: row.transfer_id ?? null,
    transfer_account: row.transfer_account ?? null,
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

  const rows = await db.all<db.DbTrade & { transfer_account: string | null }>(
    `SELECT t.*, other.account AS transfer_account FROM trades t
     JOIN accounts a ON a.id = t.account
     LEFT JOIN trades other ON other.id = t.transfer_id AND other.tombstone = 0
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
  quantity = 0,
  price = 0,
  fee = 0,
  withheld = 0,
  amount = 0,
  transfer_account,
}: Pick<TradeEntity, 'account' | 'security' | 'date' | 'type'> & {
  quantity?: number | undefined;
  price?: number | undefined;
  fee?: number | undefined;
  withheld?: number | undefined;
  amount?: number | undefined;
  // For a move out: the account the shares go to
  transfer_account?: TradeEntity['account'] | undefined;
}): Promise<TradeEntity['id']> {
  const fields = { date, type, quantity, price, fee, withheld, amount };
  validateTradeFields(fields);
  if (type === 'move-in') {
    throw new ValidationError(
      'a move is made from the account the shares leave, as a move-out',
    );
  }

  const [dbAccount, dbSecurity] = await Promise.all([
    getOpenInvestmentAccount(account),
    getSecurity(security),
  ]);
  if (dbAccount.currency !== dbSecurity.currency) {
    throw new ValidationError(
      `trade of a ${dbSecurity.currency} security needs a ${dbSecurity.currency} account`,
    );
  }
  const dbToAccount =
    type === 'move-out'
      ? await getMoveDestination(dbAccount, transfer_account)
      : null;

  const existing = await getTrades({ account, security });
  const splits = await getConfirmedSplits(security);
  if (sellsMoreThanHeld([...existing, fields], splits)) {
    throw new ValidationError('trade sells more shares than are held');
  }

  let id = '';
  await batchMessages(async () => {
    if (dbToAccount) {
      const inId = await insertTrade(dbToAccount, dbSecurity, {
        ...fields,
        type: 'move-in',
        otherAccount: dbAccount,
      });
      id = await insertTrade(dbAccount, dbSecurity, {
        ...fields,
        otherAccount: dbToAccount,
        transfer_id: inId,
      });
      await db.update('trades', { id: inId, transfer_id: id });
    } else {
      id = await insertTrade(dbAccount, dbSecurity, fields);
    }
  });
  await updateMarketValue(account);
  if (dbToAccount) {
    await updateMarketValue(dbToAccount.id);
  }
  return id;
}

// Stores a trade and the transaction that moves its cash
async function insertTrade(
  account: db.DbAccount,
  security: db.DbSecurity,
  {
    otherAccount,
    transfer_id = null,
    ...fields
  }: TradeFields & {
    otherAccount?: db.DbAccount;
    transfer_id?: string | null;
  },
): Promise<TradeEntity['id']> {
  const transactionId = await db.insertTransaction(
    getTransactionFields(account.id, security, fields, otherAccount),
  );
  return db.insertWithUUID('trades', {
    account: account.id,
    security: security.id,
    ...fields,
    date: db.toDateRepr(fields.date),
    transfer_id,
    transaction_id: transactionId,
    tombstone: 0,
  });
}

// The open investment account in the same currency that a move out goes to
async function getMoveDestination(
  from: db.DbAccount,
  to: TradeEntity['account'] | undefined,
): Promise<db.DbAccount> {
  if (!to) {
    throw new ValidationError('a move-out needs the account the shares go to');
  }
  if (to === from.id) {
    throw new ValidationError('shares can only move to another account');
  }
  const account = await getOpenInvestmentAccount(to);
  if (account.currency !== from.currency) {
    throw new ValidationError(
      `shares can only move to another ${from.currency} account`,
    );
  }
  return account;
}

async function updateTrade({
  id,
  ...changes
}: Pick<TradeEntity, 'id'> & Partial<TradeFields>): Promise<void> {
  const trade = await getStoredTrade(id);
  const type = changes.type ?? trade.type;
  if (
    type !== trade.type &&
    !TRADE_TYPE_GROUPS.some(
      group => group.includes(type) && group.includes(trade.type),
    )
  ) {
    throw new ValidationError(
      `a ${trade.type} trade can't be changed to a ${type}`,
    );
  }
  const fields: TradeFields = {
    date: changes.date ?? trade.date,
    type,
    quantity: changes.quantity ?? trade.quantity,
    price: changes.price ?? trade.price,
    // Only buys and sells have a fee, and only vests withhold shares
    fee: type === 'buy' || type === 'sell' ? (changes.fee ?? trade.fee) : 0,
    withheld: type === 'vest' ? (changes.withheld ?? trade.withheld) : 0,
    amount: isCashOnly(type) ? (changes.amount ?? trade.amount) : 0,
  };
  validateTradeFields(fields);

  const other = isMove(trade.type) ? await getOtherHalf(trade) : null;
  const halves = [
    { trade, fields },
    ...(other
      ? [{ trade: other, fields: { ...fields, type: other.type } }]
      : []),
  ];
  const splits = await getConfirmedSplits(trade.security);
  for (const half of halves) {
    const others = await getOtherTrades(half.trade);
    if (sellsMoreThanHeld([...others, half.fields], splits)) {
      throw new ValidationError('trade sells more shares than are held');
    }
  }

  const dbSecurity = await getSecurity(trade.security);
  const accounts = await getAccountsById(
    halves.map(half => half.trade.account),
  );
  await batchMessages(async () => {
    for (const half of halves) {
      const otherAccount = halves.find(h => h !== half)?.trade.account;
      await saveTrade(
        half.trade,
        half.fields,
        getTransactionFields(
          half.trade.account,
          dbSecurity,
          half.fields,
          otherAccount ? accounts.get(otherAccount) : undefined,
        ),
      );
    }
  });
  for (const half of halves) {
    await updateMarketValue(half.trade.account);
  }
}

// Saves a stored trade's fields and its transaction
async function saveTrade(
  trade: TradeEntity,
  fields: TradeFields,
  transaction: ReturnType<typeof getTransactionFields>,
) {
  const linked =
    trade.transaction_id &&
    (await db.first<Pick<db.DbTransaction, 'id'>>(
      'SELECT id FROM transactions WHERE id = ? AND tombstone = 0',
      [trade.transaction_id],
    ));
  let transactionId = trade.transaction_id;
  if (linked) {
    await db.updateTransaction({ id: linked.id, ...transaction });
  } else {
    // The transaction was deleted from the account, so bring the cash back
    transactionId = await db.insertTransaction(transaction);
  }
  await db.update('trades', {
    id: trade.id,
    ...fields,
    date: db.toDateRepr(fields.date),
    transaction_id: transactionId,
  });
}

// Deleting either half of a move deletes both
async function deleteTrade({ id }: Pick<TradeEntity, 'id'>): Promise<void> {
  const trade = await getStoredTrade(id);
  const other = isMove(trade.type) ? await getOtherHalf(trade) : null;
  const halves = other ? [trade, other] : [trade];

  const splits = await getConfirmedSplits(trade.security);
  for (const half of halves) {
    const others = await getOtherTrades(half);
    if (sellsMoreThanHeld(others, splits)) {
      throw new ValidationError(
        'deleting this trade would leave later sells with more shares than are held',
      );
    }
  }

  await batchMessages(async () => {
    for (const half of halves) {
      if (half.transaction_id) {
        await db.deleteTransaction({ id: half.transaction_id });
      }
      await db.delete_('trades', half.id);
    }
  });
  for (const half of halves) {
    await updateMarketValue(half.account);
  }
}

// The other half of a move, unless its account was deleted
async function getOtherHalf(trade: TradeEntity): Promise<TradeEntity | null> {
  if (!trade.transfer_id) {
    return null;
  }
  const [other] = (await getTrades({ security: trade.security })).filter(
    candidate => candidate.id === trade.transfer_id,
  );
  return other ?? null;
}

async function getAccountsById(
  ids: Array<db.DbAccount['id']>,
): Promise<Map<db.DbAccount['id'], db.DbAccount>> {
  const rows = await db.all<db.DbAccount>(
    `SELECT * FROM accounts WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return new Map(rows.map(row => [row.id, row]));
}

// A security's trades in an account, ready to work out a position: each move
// in carries the cost its shares had in the account they left
async function getHoldingTrades(
  account: TradeEntity['account'],
  security: SecurityEntity['id'],
  splits: Array<Pick<SecuritySplitEntity, 'date' | 'ratio'>>,
): Promise<HoldingTrade[]> {
  const trades = await getTrades({ security });
  const costs = getMoveInCosts(trades, splits);
  return trades
    .filter(trade => trade.account === account)
    .map(trade =>
      trade.type === 'move-in'
        ? { ...trade, cost: costs.get(trade.id) }
        : trade,
    );
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

  const tradedSecurities = securities.filter(security =>
    trades.some(trade => trade.security === security.id),
  );
  const holdings = await Promise.all(
    tradedSecurities.map(async security => {
      const securitySplits = allSplits.filter(
        split => split.security === security.id && split.status === 'confirmed',
      );
      const hasMovesIn = trades.some(
        trade => trade.security === security.id && trade.type === 'move-in',
      );
      const securityTrades = hasMovesIn
        ? await getHoldingTrades(account, security.id, securitySplits)
        : trades.filter(trade => trade.security === security.id);
      const latest = latestPrices.find(price => price.security === security.id);
      return calculateHolding(
        fromDbSecurity(security),
        securityTrades,
        latest && { date: db.fromDateRepr(latest.date), close: latest.close },
        securitySplits,
      );
    }),
  );

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
    suggestedDividends: await getSuggestedDividends({
      account,
      trades,
      splits: allSplits,
      securities: tradedSecurities,
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
  otherAccount?: Pick<db.DbAccount, 'name'>,
) {
  const shares = `${fields.quantity} ${security.symbol} @ ${fields.price}`;
  const other = otherAccount?.name ?? 'a deleted account';
  const notes = {
    buy: `Buy ${shares}`,
    sell: `Sell ${shares}`,
    vest: `Vest ${shares}${fields.withheld > 0 ? `, ${fields.withheld} withheld for tax` : ''}`,
    dividend: `Dividend ${security.symbol}`,
    'reinvested-dividend': `Reinvested dividend ${shares}`,
    'return-of-capital': `Return of capital ${security.symbol}`,
    'move-out': `Move ${shares} to ${other}`,
    'move-in': `Move ${shares} from ${other}`,
  }[fields.type];
  return {
    account,
    amount: getTradeCashAmount(fields),
    date: fields.date,
    notes,
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
  amount,
}: TradeFields) {
  validateDate('trade', date);
  if (!TRADE_TYPES.includes(type)) {
    throw new ValidationError(`trade has unknown type '${String(type)}'`);
  }
  if (isCashOnly(type)) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ValidationError(
        `${type} amount must be a positive whole number of cents`,
      );
    }
    if (quantity !== 0 || price !== 0 || fee !== 0 || withheld !== 0) {
      throw new ValidationError(
        `${type} has only an amount, not shares, a price or a fee`,
      );
    }
    return;
  }
  validatePositive('trade quantity', quantity);
  validatePositive('trade price', price);
  if (!Number.isInteger(fee) || fee < 0) {
    throw new ValidationError('trade fee must be a whole number of cents');
  }
  if (type !== 'buy' && type !== 'sell' && fee !== 0) {
    throw new ValidationError(`${type} has no fee`);
  }
  if (!Number.isFinite(withheld) || withheld < 0) {
    throw new ValidationError('trade withheld shares must be zero or more');
  }
  if (type !== 'vest' && withheld !== 0) {
    throw new ValidationError('only a vest withholds shares');
  }
  if (amount !== 0) {
    throw new ValidationError(
      'only a dividend or return of capital has an amount',
    );
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
