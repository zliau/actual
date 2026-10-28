import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { PostError, ValidationError } from '#server/errors';
import { validateCurrencyCode } from '#server/models';
import { mutator } from '#server/mutators';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { batchMessages } from '#server/sync';
import { undoable } from '#server/undo';
import * as monthUtils from '#shared/months';
import { isValidYearMonthDay } from '#shared/months';
import type { ExchangeRateEntity, ExchangeRateSource } from '#types/models';

export type ExchangeRatesHandlers = {
  'exchange-rates-get': typeof getExchangeRates;
  'exchange-rate-set': typeof setExchangeRate;
  'exchange-rate-delete': typeof deleteExchangeRate;
  'exchange-rates-fetch': typeof fetchExchangeRates;
  'exchange-rates-update': typeof updateExchangeRates;
};

export const app = createApp<ExchangeRatesHandlers>();
app.method('exchange-rates-get', getExchangeRates);
app.method('exchange-rate-set', mutator(undoable(setExchangeRate)));
app.method('exchange-rate-delete', mutator(undoable(deleteExchangeRate)));
app.method('exchange-rates-fetch', mutator(fetchExchangeRates));
app.method('exchange-rates-update', mutator(updateExchangeRates));

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

// Stores the rate for a currency pair on a day and updates the converted
// amounts of the transactions it applies to
async function setExchangeRate(
  exchangeRate: Parameters<typeof storeExchangeRate>[0],
): Promise<ExchangeRateEntity['id']> {
  const { date, from_currency, to_currency } = exchangeRate;
  // Days before the earliest rate of a pair fall back to it, so a new
  // earliest rate also changes them
  const earlier = await db.first<Pick<db.DbExchangeRate, 'id'>>(
    `SELECT id FROM exchange_rates
     WHERE tombstone = 0 AND date < ? AND (
       (from_currency = ? AND to_currency = ?) OR
       (from_currency = ? AND to_currency = ?)
     )
     LIMIT 1`,
    [
      db.toDateRepr(date),
      from_currency,
      to_currency,
      to_currency,
      from_currency,
    ],
  );

  const id = await storeExchangeRate(exchangeRate);
  await db.updateConvertedAmounts({
    currencies: [from_currency, to_currency],
    ...(earlier && { start: date }),
  });
  return id;
}

// Stores the rate for a currency pair on a day, replacing the one already
// stored for that day. A rate from the API never replaces one the user
// entered, so manual corrections survive the next fetch.
async function storeExchangeRate({
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
  const row = await db.first<
    Pick<db.DbExchangeRate, 'date' | 'from_currency' | 'to_currency'>
  >(
    'SELECT date, from_currency, to_currency FROM exchange_rates WHERE id = ?',
    [id],
  );
  await db.delete_('exchange_rates', id);
  if (row) {
    // Days before the deleted rate can fall back to it when no earlier rate
    // exists, so update the whole currency
    await db.updateConvertedAmounts({
      currencies: [row.from_currency, row.to_currency],
    });
  }
}

// Currencies of accounts that differ from the main currency
async function getForeignCurrencies(mainCurrency: string): Promise<string[]> {
  const rows = await db.all<{ currency: string }>(
    `SELECT DISTINCT currency FROM accounts
     WHERE tombstone = 0 AND currency IS NOT NULL AND currency != ?
     ORDER BY currency`,
    [mainCurrency],
  );
  return rows.map(row => row.currency);
}

type FetchExchangeRatesResult =
  | { error: 'unauthorized' | 'no-server' | 'no-main-currency' }
  | { count: number; unavailable: string[] };

// The longest range of days the sync server returns rates for at once
const MAX_FETCH_DAYS = 365;

type DateRange = { start: string; end?: string | undefined };

// Fetches rates for each currency to the main currency via the sync server,
// for every day of the ranges `getRanges` gives it, and stores them.
// Currencies the provider does not cover are listed in `unavailable` so the
// user can enter those rates by hand.
async function fetchRates(
  getRanges: (currency: string, mainCurrency: string) => Promise<DateRange[]>,
): Promise<FetchExchangeRatesResult> {
  const userToken = await asyncStorage.getItem('user-token');
  if (!userToken) {
    return { error: 'unauthorized' };
  }

  const serverConfig = getServer();
  if (!serverConfig) {
    return { error: 'no-server' };
  }

  const mainCurrency = await db.getMainCurrency();
  if (!mainCurrency) {
    return { error: 'no-main-currency' };
  }

  const fileId = getPrefs()?.cloudFileId;
  const headers = {
    'X-ACTUAL-TOKEN': userToken,
    ...(fileId ? { 'X-Actual-File-Id': fileId } : {}),
  };

  let count = 0;
  const fetched: string[] = [];
  const unavailable: string[] = [];

  currencies: for (const currency of await getForeignCurrencies(mainCurrency)) {
    const ranges = await getRanges(currency, mainCurrency);
    for (const range of ranges) {
      let rates: Record<string, Record<string, number>>;
      try {
        ({ rates } = await post(
          serverConfig.EXCHANGE_RATES_SERVER,
          { base: currency, symbols: [mainCurrency], ...range },
          headers,
        ));
      } catch (error) {
        if (
          error instanceof PostError &&
          error.reason === 'rates-unavailable'
        ) {
          logger.warn(`No exchange rates available for ${currency}`, error);
          unavailable.push(currency);
          continue currencies;
        }
        throw error;
      }

      await batchMessages(async () => {
        for (const [date, rateByCurrency] of Object.entries(rates)) {
          const rate = rateByCurrency[mainCurrency];
          if (rate == null) {
            continue;
          }
          await storeExchangeRate({
            date,
            from_currency: currency,
            to_currency: mainCurrency,
            rate,
            source: 'api',
          });
          count++;
        }
      });
    }
    if (ranges.length > 0) {
      fetched.push(currency);
    }
  }

  // A fetched rate can also be the fallback for days before `start`
  const convertedCount =
    fetched.length > 0
      ? await db.updateConvertedAmounts({ currencies: fetched })
      : 0;

  // Rates are fetched in the background, so tell open screens what changed
  // the way a sync from another device would; transaction lists only
  // refresh on those
  if (count > 0) {
    connection.send('sync-event', {
      type: 'success',
      tables:
        convertedCount > 0
          ? ['exchange_rates', 'transactions']
          : ['exchange_rates'],
    });
  }

  return { count, unavailable };
}

// Fetches the rates from each foreign account currency to the main currency
// for the day `start` or every day from `start` to `end`
async function fetchExchangeRates({
  start,
  end,
}: {
  start: string;
  end?: string | undefined;
}): Promise<FetchExchangeRatesResult> {
  return fetchRates(async () => [{ start, end }]);
}

// Fetches the rates each foreign account currency is missing: the days after
// the latest fetched rate, or since the account's first transaction when no
// rate was fetched yet, until today
async function updateExchangeRates(): Promise<FetchExchangeRatesResult> {
  const today = monthUtils.currentDay();

  return fetchRates(async (currency, mainCurrency) => {
    const latest = await db.first<{ date: number | null }>(
      `SELECT MAX(date) AS date FROM exchange_rates
       WHERE tombstone = 0 AND source = 'api'
         AND from_currency = ? AND to_currency = ?`,
      [currency, mainCurrency],
    );
    let start: string;
    if (latest?.date != null) {
      start = monthUtils.addDays(db.fromDateRepr(latest.date), 1);
    } else {
      const first = await db.first<{ date: number | null }>(
        `SELECT MIN(t.date) AS date FROM transactions t
         JOIN accounts a ON a.id = t.acct
         WHERE t.tombstone = 0 AND a.tombstone = 0 AND a.currency = ?`,
        [currency],
      );
      start = first?.date != null ? db.fromDateRepr(first.date) : today;
    }

    // The sync server returns a limited range of days at once
    const ranges: DateRange[] = [];
    while (start <= today) {
      const end = monthUtils.addDays(start, MAX_FETCH_DAYS);
      ranges.push({ start, end: end < today ? end : today });
      start = monthUtils.addDays(end, 1);
    }
    return ranges;
  });
}
