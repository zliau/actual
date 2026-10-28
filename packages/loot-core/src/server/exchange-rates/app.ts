import { createApp } from '#server/app';
import * as db from '#server/db';
import { ValidationError } from '#server/errors';
import { validateCurrencyCode } from '#server/models';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';
import { isValidYearMonthDay } from '#shared/months';
import type { ExchangeRateEntity, ExchangeRateSource } from '#types/models';

export type ExchangeRatesHandlers = {
  'exchange-rates-get': typeof getExchangeRates;
  'exchange-rate-set': typeof setExchangeRate;
  'exchange-rate-delete': typeof deleteExchangeRate;
};

export const app = createApp<ExchangeRatesHandlers>();
app.method('exchange-rates-get', getExchangeRates);
app.method('exchange-rate-set', mutator(undoable(setExchangeRate)));
app.method('exchange-rate-delete', mutator(undoable(deleteExchangeRate)));

function fromDbExchangeRate(row: db.DbExchangeRate): ExchangeRateEntity {
  return {
    id: row.id,
    date: db.fromDateRepr(row.date),
    from_currency: row.from_currency,
    to_currency: row.to_currency,
    rate: row.rate,
    source: row.source,
  };
}

async function getExchangeRates({
  from_currency,
  to_currency,
}: Partial<
  Pick<ExchangeRateEntity, 'from_currency' | 'to_currency'>
> = {}): Promise<ExchangeRateEntity[]> {
  const conditions = ['tombstone = 0'];
  const params: string[] = [];
  if (from_currency !== undefined) {
    conditions.push('from_currency = ?');
    params.push(from_currency);
  }
  if (to_currency !== undefined) {
    conditions.push('to_currency = ?');
    params.push(to_currency);
  }

  const rows = await db.all<db.DbExchangeRate>(
    `SELECT * FROM exchange_rates WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC, from_currency, to_currency, id`,
    params,
  );
  return rows.map(fromDbExchangeRate);
}

// Stores the rate for a currency pair on a day, replacing the one already
// stored for that day. A rate from the API never replaces one the user
// entered, so manual corrections survive the next fetch.
async function setExchangeRate({
  date,
  from_currency,
  to_currency,
  rate,
  source = 'manual',
}: Pick<
  ExchangeRateEntity,
  'date' | 'from_currency' | 'to_currency' | 'rate'
> & { source?: ExchangeRateSource }): Promise<ExchangeRateEntity['id']> {
  validateCurrencyCode('exchangeRate', from_currency);
  validateCurrencyCode('exchangeRate', to_currency);
  if (from_currency === to_currency) {
    throw new ValidationError(
      'exchangeRate must convert between two different currencies',
    );
  }
  if (!isValidYearMonthDay(date)) {
    throw new ValidationError(`exchangeRate has invalid date '${date}'`);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ValidationError('exchangeRate must be a positive number');
  }

  const existing = await db.first<Pick<db.DbExchangeRate, 'id' | 'source'>>(
    `SELECT id, source FROM exchange_rates
     WHERE tombstone = 0 AND date = ? AND from_currency = ? AND to_currency = ?
     ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END, id
     LIMIT 1`,
    [db.toDateRepr(date), from_currency, to_currency],
  );

  if (existing) {
    if (source === 'api' && existing.source === 'manual') {
      return existing.id;
    }
    await db.update('exchange_rates', { id: existing.id, rate, source });
    return existing.id;
  }

  return db.insertWithUUID('exchange_rates', {
    date: db.toDateRepr(date),
    from_currency,
    to_currency,
    rate,
    source,
  });
}

async function deleteExchangeRate({
  id,
}: Pick<ExchangeRateEntity, 'id'>): Promise<void> {
  await db.delete_('exchange_rates', id);
}

// Returns how many units of `toCurrency` one unit of `fromCurrency` is worth
// on `date`, using the latest rate stored on or before that day. A rate stored
// for the opposite direction is inverted. Returns null when no rate is known.
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number | null> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const row = await db.first<Pick<db.DbExchangeRate, 'from_currency' | 'rate'>>(
    `SELECT from_currency, rate FROM exchange_rates
     WHERE tombstone = 0 AND date <= ?
       AND ((from_currency = ? AND to_currency = ?)
         OR (from_currency = ? AND to_currency = ?))
     ORDER BY date DESC,
       CASE source WHEN 'manual' THEN 0 ELSE 1 END,
       from_currency = ? DESC,
       id
     LIMIT 1`,
    [
      db.toDateRepr(date),
      fromCurrency,
      toCurrency,
      toCurrency,
      fromCurrency,
      fromCurrency,
    ],
  );

  if (!row) {
    return null;
  }
  return row.from_currency === fromCurrency ? row.rate : 1 / row.rate;
}
