import { createApp } from '#server/app';
import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { undoable } from '#server/undo';
import {
  getExchangeCurrency,
  getTradeCashAmount,
  isSecurityExchange,
  sellsMoreThanHeld,
} from '#shared/investments';
import { isValidYearMonthDay } from '#shared/months';
import type {
  SecurityEntity,
  SecurityExchange,
  SecurityPriceEntity,
  SecurityPriceSource,
  TradeEntity,
} from '#types/models';

export type InvestmentsHandlers = {
  'securities-get': typeof getSecurities;
  'security-create': typeof createSecurity;
  'security-prices-get': typeof getSecurityPrices;
  'security-price-set': typeof setSecurityPrice;
  'security-price-delete': typeof deleteSecurityPrice;
  'trades-get': typeof getTrades;
  'trade-create': typeof createTrade;
  'trade-update': typeof updateTrade;
  'trade-delete': typeof deleteTrade;
};

export const app = createApp<InvestmentsHandlers>();
app.method('securities-get', getSecurities);
app.method('security-create', mutator(undoable(createSecurity)));
app.method('security-prices-get', getSecurityPrices);
app.method('security-price-set', mutator(undoable(setSecurityPrice)));
app.method('security-price-delete', mutator(undoable(deleteSecurityPrice)));
app.method('trades-get', getTrades);
app.method('trade-create', mutator(undoable(createTrade)));
app.method('trade-update', mutator(undoable(updateTrade)));
app.method('trade-delete', mutator(undoable(deleteTrade)));

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

type TradeFields = Pick<
  TradeEntity,
  'date' | 'type' | 'quantity' | 'price' | 'fee'
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
    transaction_id: row.transaction_id ?? null,
  };
}

async function getSecurities(): Promise<SecurityEntity[]> {
  const rows = await db.all<db.DbSecurity>(
    'SELECT * FROM securities WHERE tombstone = 0 ORDER BY symbol, exchange',
  );
  return rows.map(fromDbSecurity);
}

// Adds a security, or updates the name of the one already stored. The id comes
// from the exchange and symbol so devices adding the same security while they
// can't sync end up with one row.
async function createSecurity({
  symbol,
  exchange,
  name = null,
}: {
  symbol: string;
  exchange: SecurityExchange;
  name?: string | null | undefined;
}): Promise<SecurityEntity['id']> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!SYMBOL.test(normalizedSymbol)) {
    throw new ValidationError(`security has invalid symbol '${symbol}'`);
  }
  if (!isSecurityExchange(exchange)) {
    throw new ValidationError(
      `security has unknown exchange '${String(exchange)}'`,
    );
  }

  const id = `${exchange}-${normalizedSymbol}`;
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

// Stores a security's close for a day, replacing the one already stored. A
// fetched price never replaces one the user entered, so manual corrections
// survive the next fetch.
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

  // The id comes from the security and day so devices storing the same price
  // while they can't sync end up with one row. Clearing the tombstone brings
  // back a price that was deleted.
  const id = `${security}-${date}`;
  const existing = await db.first<
    Pick<db.DbSecurityPrice, 'source' | 'tombstone'>
  >('SELECT source, tombstone FROM security_prices WHERE id = ?', [id]);

  if (existing) {
    if (
      source === 'api' &&
      existing.source === 'manual' &&
      !existing.tombstone
    ) {
      return id;
    }
    await db.update('security_prices', { id, close, source, tombstone: 0 });
    return id;
  }

  await db.insert('security_prices', {
    id,
    security,
    date: db.toDateRepr(date),
    close,
    source,
    tombstone: 0,
  });
  return id;
}

async function deleteSecurityPrice({
  id,
}: Pick<SecurityPriceEntity, 'id'>): Promise<void> {
  await db.delete_('security_prices', id);
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
}: Pick<TradeEntity, 'account' | 'security'> &
  Omit<TradeFields, 'fee'> & { fee?: number | undefined }): Promise<
  TradeEntity['id']
> {
  const fields = { date, type, quantity, price, fee };
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
  if (sellsMoreThanHeld([...existing, fields])) {
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
      transaction_id: transactionId,
      tombstone: 0,
    });
  });
  return id;
}

async function updateTrade({
  id,
  ...changes
}: Pick<TradeEntity, 'id'> & Partial<TradeFields>): Promise<void> {
  const trade = await getStoredTrade(id);
  const fields: TradeFields = {
    date: changes.date ?? trade.date,
    type: changes.type ?? trade.type,
    quantity: changes.quantity ?? trade.quantity,
    price: changes.price ?? trade.price,
    fee: changes.fee ?? trade.fee,
  };
  validateTradeFields(fields);

  const others = await getOtherTrades(trade);
  if (sellsMoreThanHeld([...others, fields])) {
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
}

async function deleteTrade({ id }: Pick<TradeEntity, 'id'>): Promise<void> {
  const trade = await getStoredTrade(id);

  const others = await getOtherTrades(trade);
  if (sellsMoreThanHeld(others)) {
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
  const label = fields.type === 'buy' ? 'Buy' : 'Sell';
  return {
    account,
    amount: getTradeCashAmount(fields),
    date: fields.date,
    notes: `${label} ${fields.quantity} ${security.symbol} @ ${fields.price}`,
    cleared: true,
  };
}

function validateTradeFields({
  date,
  type,
  quantity,
  price,
  fee,
}: TradeFields) {
  validateDate('trade', date);
  if (type !== 'buy' && type !== 'sell') {
    throw new ValidationError(`trade has unknown type '${String(type)}'`);
  }
  validatePositive('trade quantity', quantity);
  validatePositive('trade price', price);
  if (!Number.isInteger(fee) || fee < 0) {
    throw new ValidationError('trade fee must be a whole number of cents');
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
