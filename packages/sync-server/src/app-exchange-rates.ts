import express from 'express';
import { fetch } from 'undici';

import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';

// European Central Bank reference rates, published on working days. Free and
// needs no API key, but only covers about 30 currencies.
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_RANGE_DAYS = 366;

const CURRENCY_CODE = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Rates by day, then by currency: { '2026-01-02': { EUR: 0.91 } }
type RatesByDate = Record<string, Record<string, number>>;

type FrankfurterResponse = {
  base: string;
  // A single day returns `date` and flat `rates`; a range returns rates by day
  date?: string;
  rates: Record<string, number> | RatesByDate;
};

const cache = new Map<string, { expires: number; rates: RatesByDate }>();

const app = express();
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(validateSessionMiddleware);

export { app as handlers };

// Returns rates from `base` to each of `symbols` for the day `start`, or for
// every published day from `start` to `end`. Days without a publication (such
// as weekends) are missing; callers should use the latest earlier day.
app.post('/', async (req, res) => {
  const { base, symbols, start, end } = req.body || {};

  if (
    typeof base !== 'string' ||
    !CURRENCY_CODE.test(base) ||
    !Array.isArray(symbols) ||
    symbols.length === 0 ||
    !symbols.every(
      symbol => typeof symbol === 'string' && CURRENCY_CODE.test(symbol),
    ) ||
    !isValidDate(start) ||
    (end !== undefined && !isValidDate(end)) ||
    (end !== undefined &&
      (end < start || daysBetween(start, end) > MAX_RANGE_DAYS))
  ) {
    res.status(400).send({ status: 'error', reason: 'invalid-request' });
    return;
  }

  const path = end ? `${start}..${end}` : start;
  const url = `${FRANKFURTER_URL}/${path}?base=${base}&symbols=${[...symbols].sort((a, b) => a.localeCompare(b)).join(',')}`;

  try {
    const rates = await getRates(url);
    res.send({ status: 'ok', data: { base, rates } });
  } catch (error) {
    res.send({
      status: 'error',
      reason: 'rates-unavailable',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

async function getRates(url: string): Promise<RatesByDate> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) {
    return cached.rates;
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Exchange rate provider responded with ${response.status}`);
  }

  const body = (await response.json()) as FrankfurterResponse;
  const rates: RatesByDate = body.date
    ? { [body.date]: body.rates as Record<string, number> }
    : (body.rates as RatesByDate);

  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(url, { expires: Date.now() + CACHE_TTL_MS, rates });

  return rates;
}

function isValidDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function daysBetween(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / (24 * 60 * 60 * 1000);
}

export function clearExchangeRatesCache() {
  cache.clear();
}
