import express from 'express';
import { fetch } from 'undici';

import { SecretName, secretsService } from './services/secrets-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';

// US stocks and funds. The closes are as traded, with no split adjustment, and
// go back as far as needed. The free plan is for personal use, so each server
// uses its owner's token.
const TIINGO_URL = 'https://api.tiingo.com/tiingo';
// Toronto stocks, which Tiingo doesn't have. Yahoo has no official API, so this
// is the data its own site uses: it needs no key and goes back as far as
// needed, but can change or be blocked without notice. Its closes are adjusted
// for later splits, so they are turned back into as traded.
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query2.finance.yahoo.com/v1/finance/search';
// Yahoo turns away requests without a browser's user agent
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
// How long after the close Yahoo's last close of the day is final
const YAHOO_SETTLE_SECONDS = 30 * 60;

const TIINGO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const YAHOO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUERY_LENGTH = 50;
const MAX_SEARCH_RESULTS = 20;

type Exchange = 'US' | 'TSX';
// `splitFactor` is only there on the day of a split
type Price = { date: string; close: number; splitFactor?: number };
type SearchResult = { symbol: string; name: string };
type FailureReason =
  | 'not-configured'
  | 'invalid-key'
  | 'rate-limited'
  | 'unknown-symbol'
  | 'prices-unavailable';

class ProviderError extends Error {
  reason: FailureReason;

  constructor(reason: FailureReason) {
    super(reason);
    this.reason = reason;
  }
}

type CacheEntry = {
  expires: number;
  result: Price[] | SearchResult[] | ProviderError;
};
const cache = new Map<string, CacheEntry>();

const app = express();
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(validateSessionMiddleware);

export { app as handlers };

// Which exchanges prices can be fetched for: Toronto needs no key
app.post('/status', (_req, res) => {
  res.send({
    status: 'ok',
    data: {
      US: secretsService.exists(SecretName.tiingo_token),
      TSX: true,
    },
  });
});

// Returns the closes of a security from `start` to `end`, as traded. Days
// without trading are missing. A split is on the first day at its new price.
app.post('/prices', async (req, res) => {
  const { exchange, symbol, start, end } = req.body || {};
  if (
    !isExchange(exchange) ||
    typeof symbol !== 'string' ||
    !SYMBOL.test(symbol) ||
    !isValidDate(start) ||
    !isValidDate(end) ||
    end < start
  ) {
    res.status(400).send({ status: 'error', reason: 'invalid-request' });
    return;
  }

  await respond(res, async () => ({
    prices:
      exchange === 'US'
        ? await getTiingoPrices(symbol, start, end)
        : await getYahooPrices(symbol, start, end),
  }));
});

// Finds securities on an exchange by symbol or name
app.post('/search', async (req, res) => {
  const { exchange, query } = req.body || {};
  if (
    !isExchange(exchange) ||
    typeof query !== 'string' ||
    query.trim() === '' ||
    query.length > MAX_QUERY_LENGTH
  ) {
    res.status(400).send({ status: 'error', reason: 'invalid-request' });
    return;
  }

  await respond(res, async () => ({
    results: (exchange === 'US'
      ? await searchTiingo(query.trim())
      : await searchYahoo(query.trim())
    ).slice(0, MAX_SEARCH_RESULTS),
  }));
});

// Failures don't include what the provider said, since a request's URL can hold
// the key
async function respond(
  res: express.Response,
  getData: () => Promise<Record<string, unknown>>,
) {
  try {
    res.send({ status: 'ok', data: await getData() });
  } catch (error) {
    res.send({
      status: 'error',
      reason:
        error instanceof ProviderError ? error.reason : 'prices-unavailable',
    });
  }
}

// Requests use up a limited allowance, so answers are kept for a while. That
// includes a symbol the provider doesn't know, since it won't know it later
// today either. Other failures can pass, so they are tried again.
async function cached<T extends Price[] | SearchResult[]>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    if (entry.result instanceof ProviderError) {
      throw entry.result;
    }
    return entry.result as T;
  }

  const store = (result: CacheEntry['result']) => {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
    cache.set(key, { expires: Date.now() + ttl, result });
  };

  try {
    const result = await load();
    store(result);
    return result;
  } catch (error) {
    if (error instanceof ProviderError && error.reason === 'unknown-symbol') {
      store(error);
    }
    throw error;
  }
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
    });
  } catch {
    throw new ProviderError('prices-unavailable');
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('invalid-key');
  }
  if (response.status === 404) {
    throw new ProviderError('unknown-symbol');
  }
  if (response.status === 429) {
    throw new ProviderError('rate-limited');
  }
  if (!response.ok) {
    throw new ProviderError('prices-unavailable');
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderError('prices-unavailable');
  }
}

function getTiingoHeaders() {
  const token = secretsService.get(SecretName.tiingo_token);
  if (!token) {
    throw new ProviderError('not-configured');
  }
  return { Authorization: `Token ${token}` };
}

function getTiingoPrices(symbol: string, start: string, end: string) {
  const headers = getTiingoHeaders();
  return cached(
    `tiingo:${symbol}:${start}:${end}`,
    TIINGO_CACHE_TTL_MS,
    async () => {
      // Tiingo writes share classes with a dash: BRK-B
      const ticker = encodeURIComponent(symbol.replace('.', '-').toLowerCase());
      const body = await getJson(
        `${TIINGO_URL}/daily/${ticker}/prices?startDate=${start}&endDate=${end}`,
        headers,
      );
      if (!Array.isArray(body)) {
        throw new ProviderError('prices-unavailable');
      }
      return (
        body as Array<{ date: string; close: number; splitFactor?: number }>
      ).map(row => ({
        date: row.date.slice(0, 10),
        close: row.close,
        ...(row.splitFactor != null &&
          row.splitFactor !== 1 && { splitFactor: row.splitFactor }),
      }));
    },
  );
}

function searchTiingo(query: string) {
  const headers = getTiingoHeaders();
  return cached(
    `tiingo-search:${query.toLowerCase()}`,
    TIINGO_CACHE_TTL_MS,
    async () => {
      const body = await getJson(
        `${TIINGO_URL}/utilities/search?query=${encodeURIComponent(query)}`,
        headers,
      );
      if (!Array.isArray(body)) {
        throw new ProviderError('prices-unavailable');
      }
      // There is no exchange to go by, but Chinese listings are all digits
      return (
        body as Array<{ ticker: string; name: string; isActive?: boolean }>
      )
        .filter(row => row.isActive !== false && !/^\d+$/.test(row.ticker))
        .map(row => ({ symbol: row.ticker.toUpperCase(), name: row.name }));
    },
  );
}

type YahooChart = {
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  events?: {
    splits?: Record<
      string,
      { date: number; numerator: number; denominator: number }
    >;
  };
  meta?: { currentTradingPeriod?: { regular?: { end?: number } } };
};

function getYahooPrices(symbol: string, start: string, end: string) {
  return cached(`yahoo:${symbol}:${start}:${end}`, YAHOO_CACHE_TTL_MS, () =>
    loadYahooPrices(symbol, start, end),
  );
}

async function loadYahooPrices(
  symbol: string,
  start: string,
  end: string,
): Promise<Price[]> {
  const now = Math.floor(Date.now() / 1000);
  // Through today, since undoing the split adjustment needs every later split
  const period1 = Date.parse(`${start}T00:00:00Z`) / 1000;
  const body = await getYahooJson(
    `${YAHOO_CHART_URL}/${getYahooTicker(symbol)}` +
      `?period1=${period1}&period2=${now}&interval=1d&events=split`,
  );
  const chart = body['chart'] as
    | { result?: YahooChart[] | null; error?: { code?: string } | null }
    | undefined;
  if (chart?.error?.code === 'Not Found') {
    throw new ProviderError('unknown-symbol');
  }
  const result = chart?.result?.[0];
  if (!result) {
    throw new ProviderError('prices-unavailable');
  }

  // Each event's moment is when the market opened that day
  const splits = Object.values(result.events?.splits ?? {})
    .filter(split => split.numerator > 0 && split.denominator > 0)
    .map(split => ({
      date: toTorontoDate(split.date),
      ratio: split.numerator / split.denominator,
    }));
  // Yahoo divides what came before a split by its ratio
  const unadjust = (date: string, value: number) =>
    roundPrice(
      splits
        .filter(split => split.date > date)
        .reduce((total, split) => total * split.ratio, value),
    );

  // Today's close isn't final until a while after the market closes
  const closeTime = result.meta?.currentTradingPeriod?.regular?.end;
  const unsettledDate =
    closeTime != null && now < closeTime + YAHOO_SETTLE_SECONDS
      ? toTorontoDate(closeTime)
      : null;

  const closes = result.indicators?.quote?.[0]?.close ?? [];
  return (result.timestamp ?? []).flatMap((time, index) => {
    const date = toTorontoDate(time);
    const close = closes[index];
    if (
      close == null ||
      !Number.isFinite(close) ||
      close <= 0 ||
      date < start ||
      date > end ||
      date === unsettledDate
    ) {
      return [];
    }
    const split = splits.find(split => split.date === date);
    return [
      {
        date,
        close: unadjust(date, close),
        ...(split && split.ratio !== 1 && { splitFactor: split.ratio }),
      },
    ];
  });
}

function searchYahoo(query: string) {
  return cached(
    `yahoo-search:${query.toLowerCase()}`,
    YAHOO_CACHE_TTL_MS,
    async () => {
      const body = await getYahooJson(
        `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(query)}` +
          '&quotesCount=20&newsCount=0&listsCount=0',
      );
      const quotes = (body['quotes'] ?? []) as Array<{
        symbol?: string;
        exchange?: string;
        shortname?: string;
        longname?: string;
      }>;
      return quotes.flatMap(quote =>
        quote.exchange === 'TOR' && quote.symbol?.endsWith('.TO')
          ? [
              {
                // Back to how Toronto writes share classes: CTC.A
                symbol: quote.symbol.replace(/\.TO$/, '').replace('-', '.'),
                name: quote.longname ?? quote.shortname ?? quote.symbol,
              },
            ]
          : [],
      );
    },
  );
}

// Yahoo takes no key, so being turned away isn't something a key can fix
async function getYahooJson(url: string) {
  try {
    return await getJson(url, YAHOO_HEADERS);
  } catch (error) {
    if (error instanceof ProviderError && error.reason === 'invalid-key') {
      throw new ProviderError('prices-unavailable');
    }
    throw error;
  }
}

// Yahoo writes share classes with a dash, like CTC-A.TO
function getYahooTicker(symbol: string) {
  return encodeURIComponent(`${symbol.replace('.', '-')}.TO`);
}

// Yahoo's numbers carry float noise, like 42.034000396728516
function roundPrice(value: number) {
  return Math.round(value * 10000) / 10000;
}

const torontoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The day a moment falls on in Toronto, like 2026-01-26
function toTorontoDate(seconds: number) {
  return torontoDate.format(new Date(seconds * 1000));
}

function isExchange(value: unknown): value is Exchange {
  return value === 'US' || value === 'TSX';
}

function isValidDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function clearSecuritiesCache() {
  cache.clear();
}
