import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { PostError } from '#server/errors';
import { post } from '#server/post';
import { getServer } from '#server/server-config';
import { batchMessages } from '#server/sync';
import {
  getPriceFetchRange,
  getSecurityId,
  isSecurityExchange,
  isValidSymbol,
  normalizeSymbol,
  selectPricesToStore,
  SHARE_EPSILON,
} from '#shared/investments';
import { currentDay, isValidYearMonthDay, subDays } from '#shared/months';
import type {
  SecurityCloseResult,
  SecurityExchange,
  SecurityProviderFailure,
  SecuritySearchResult,
  UpdateSecurityPricesResult,
} from '#types/models';

import { updateMarketValue } from './market-value';
import { storeSecurityPrice } from './store-price';

// How far back a trade's suggested price can come from, to get past weekends
// and holidays like Easter
const CLOSE_LOOKBACK_DAYS = 6;

// Problems with an exchange's key or allowance affect all its securities
const EXCHANGE_PROBLEMS: SecurityProviderFailure[] = [
  'not-configured',
  'invalid-key',
  'rate-limited',
];

// The fetches already tried for the open budget, with the day they were tried.
// One that brings nothing new, as for a delisted security or after a market
// holiday, would otherwise be repeated on every update. It is tried again the
// next day, or when the budget is opened again.
type FetchAttempt = { day: string; isUnavailable: boolean };
const attemptedFetches = new WeakMap<object, Map<string, FetchAttempt>>();

function getAttemptedFetches(today: string): Map<string, FetchAttempt> {
  const database = db.getDatabase();
  if (!database) {
    return new Map();
  }
  let attempts = attemptedFetches.get(database);
  if (!attempts) {
    attempts = new Map();
    attemptedFetches.set(database, attempts);
  }
  for (const [key, { day }] of attempts) {
    if (day !== today) {
      attempts.delete(key);
    }
  }
  return attempts;
}

// Lets every fetch be tried again, as on a new day
export function forgetAttemptedFetches() {
  const database = db.getDatabase();
  if (database) {
    attemptedFetches.delete(database);
  }
}

type HeldSecurity = {
  id: string;
  symbol: string;
  exchange: SecurityExchange;
  first_trade: number;
  last_trade: number;
  held: number;
  earliest_fetched: number | null;
  latest_fetched: number | null;
};

type RequestConfig = { url: string; headers: Record<string, string> };

async function getRequestConfig(): Promise<
  RequestConfig | { error: 'unauthorized' | 'no-server' }
> {
  const userToken = await asyncStorage.getItem('user-token');
  const serverConfig = getServer();
  if (!userToken) {
    return { error: 'unauthorized' };
  }
  if (!serverConfig) {
    return { error: 'no-server' };
  }
  return {
    url: serverConfig.SECURITIES_SERVER,
    headers: { 'X-ACTUAL-TOKEN': userToken },
  };
}

// Which exchanges have a key to fetch prices with
export async function getSecurityPriceStatus(): Promise<
  Record<SecurityExchange, boolean> | { error: string }
> {
  const config = await getRequestConfig();
  if ('error' in config) {
    return { error: config.error };
  }
  try {
    return await post(`${config.url}/status`, {}, config.headers);
  } catch (error) {
    logger.warn('Could not check for price keys', error);
    return { error: 'unavailable' };
  }
}

export async function searchSecurities({
  exchange,
  query,
}: {
  exchange: SecurityExchange;
  query: string;
}): Promise<{ results: SecuritySearchResult[] } | { error: string }> {
  const config = await getRequestConfig();
  if ('error' in config) {
    return { error: config.error };
  }
  try {
    return await post(
      `${config.url}/search`,
      { exchange, query },
      config.headers,
    );
  } catch (error) {
    return {
      error: error instanceof PostError ? error.reason : 'prices-unavailable',
    };
  }
}

// The close of a security on a day, to suggest as a trade's price. On a weekend
// or holiday that is the last close before it. A close already stored for the
// day saves a request, and stored closes stand in when the server can't help.
export async function getSecurityClose({
  exchange,
  symbol,
  date,
}: {
  exchange: SecurityExchange;
  symbol: string;
  date: string;
}): Promise<SecurityCloseResult> {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (
    !isSecurityExchange(exchange) ||
    !isValidSymbol(normalizedSymbol) ||
    !isValidYearMonthDay(date) ||
    date > currentDay()
  ) {
    return { error: 'no-close' };
  }

  const security = getSecurityId(exchange, normalizedSymbol);
  const start = subDays(date, CLOSE_LOOKBACK_DAYS);
  const stored = await db.all<Pick<db.DbSecurityPrice, 'date' | 'close'>>(
    `SELECT date, close FROM security_prices
     WHERE security = ? AND tombstone = 0 AND date >= ? AND date <= ?
     ORDER BY date DESC`,
    [security, db.toDateRepr(start), db.toDateRepr(date)],
  );
  const storedCloses = stored.map(row => ({
    date: db.fromDateRepr(row.date),
    close: row.close,
  }));
  if (storedCloses[0]?.date === date) {
    return storedCloses[0];
  }

  const config = await getRequestConfig();
  let fetched: Array<{ date: string; close: number }> = [];
  let failure:
    | Extract<SecurityCloseResult, { error: unknown }>['error']
    | null = null;
  if ('error' in config) {
    failure = config.error;
  } else {
    try {
      ({ prices: fetched } = await post(
        `${config.url}/prices`,
        { exchange, symbol: normalizedSymbol, start, end: date },
        config.headers,
      ));
    } catch (error) {
      failure = (
        error instanceof PostError ? error.reason : 'prices-unavailable'
      ) as SecurityProviderFailure;
    }
  }

  const latest = [...fetched, ...storedCloses]
    .filter(price => price.date >= start && price.date <= date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  if (latest) {
    return { date: latest.date, close: latest.close };
  }
  return { error: failure ?? 'no-close' };
}

// Fetches the closes each held security is missing, and updates what the
// accounts are worth. That update also runs without a server, since a new month
// needs its own market value transaction whether or not prices came in.
export async function updateSecurityPrices(): Promise<UpdateSecurityPricesResult> {
  const config = await getRequestConfig();
  const result: UpdateSecurityPricesResult =
    'error' in config ? config : await fetchSecurityPrices(config);

  const accounts = await db.all<Pick<db.DbAccount, 'id'>>(
    'SELECT id FROM accounts WHERE investment = 1 AND tombstone = 0 AND closed = 0',
  );
  for (const { id } of accounts) {
    await updateMarketValue(id);
  }

  // This runs in the background, so tell open screens what changed the way a
  // sync from another device would
  if ('count' in result && result.count > 0) {
    connection.send('sync-event', {
      type: 'success',
      tables: ['security_prices', 'transactions'],
    });
  }

  return result;
}

async function fetchSecurityPrices({
  url,
  headers,
}: RequestConfig): Promise<UpdateSecurityPricesResult> {
  const today = currentDay();
  const securities = await db.all<HeldSecurity>(
    `SELECT s.id, s.symbol, s.exchange,
       MIN(t.date) AS first_trade,
       MAX(t.date) AS last_trade,
       SUM(CASE t.type WHEN 'buy' THEN t.quantity ELSE -t.quantity END) AS held,
       (SELECT MIN(p.date) FROM security_prices p
        WHERE p.security = s.id AND p.source = 'api' AND p.tombstone = 0
       ) AS earliest_fetched,
       (SELECT MAX(p.date) FROM security_prices p
        WHERE p.security = s.id AND p.source = 'api' AND p.tombstone = 0
       ) AS latest_fetched
     FROM securities s
     JOIN trades t ON t.security = s.id AND t.tombstone = 0
     JOIN accounts a ON a.id = t.account AND a.tombstone = 0 AND a.closed = 0
     WHERE s.tombstone = 0
     GROUP BY s.id
     ORDER BY latest_fetched IS NOT NULL, latest_fetched, s.id`,
  );

  let count = 0;
  const problems: Partial<Record<SecurityExchange, SecurityProviderFailure>> =
    {};
  const unavailable: string[] = [];
  const attempts = getAttemptedFetches(today);

  for (const security of securities) {
    const { exchange } = security;
    if (problems[exchange]) {
      continue;
    }

    const toDate = (date: number | null) =>
      date == null ? null : db.fromDateRepr(date);
    const range = getPriceFetchRange({
      firstTrade: db.fromDateRepr(security.first_trade),
      lastTrade: db.fromDateRepr(security.last_trade),
      earliestFetched: toDate(security.earliest_fetched),
      latestFetched: toDate(security.latest_fetched),
      isHeld: security.held > SHARE_EPSILON,
      today,
    });
    if (!range) {
      continue;
    }
    // Closes that came in change the range, so the same one again means the
    // last try brought nothing new
    const attempt = `${security.id}|${range.start}|${range.end}`;
    const earlier = attempts.get(attempt);
    if (earlier) {
      if (earlier.isUnavailable) {
        unavailable.push(security.symbol);
      }
      continue;
    }

    let prices: Array<{ date: string; close: number }>;
    try {
      ({ prices } = await post(
        `${url}/prices`,
        { exchange, symbol: security.symbol, ...range },
        headers,
      ));
    } catch (error) {
      const reason = (
        error instanceof PostError ? error.reason : 'prices-unavailable'
      ) as SecurityProviderFailure;
      if (EXCHANGE_PROBLEMS.includes(reason)) {
        // A key or allowance can be fixed within the day, so this is tried
        // again
        problems[exchange] = reason;
      } else {
        logger.warn(`No prices for ${security.symbol}: ${reason}`);
        unavailable.push(security.symbol);
        attempts.set(attempt, { day: today, isUnavailable: true });
      }
      continue;
    }
    attempts.set(attempt, { day: today, isUnavailable: false });

    await batchMessages(async () => {
      for (const { date, close } of selectPricesToStore(prices, today)) {
        await storeSecurityPrice({
          security: security.id,
          date,
          close,
          source: 'api',
        });
        count++;
      }
    });
  }

  return { count, problems, unavailable };
}
