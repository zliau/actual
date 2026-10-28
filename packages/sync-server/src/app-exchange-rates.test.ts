import request from 'supertest';
import * as undici from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers as app, clearExchangeRatesCache } from './app-exchange-rates';

vi.mock('undici', async importOriginal => ({
  ...(await importOriginal<typeof undici>()),
  fetch: vi.fn(),
}));

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as Awaited<ReturnType<typeof undici.fetch>>;

const post = (body: object) =>
  request(app).post('/').set('x-actual-token', 'valid-token').send(body);

describe('app-exchange-rates', () => {
  beforeEach(() => {
    clearExchangeRatesCache();
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(undici.fetch).mockReset();
  });

  it('requires a session', async () => {
    const res = await request(app)
      .post('/')
      .send({ base: 'USD', symbols: ['EUR'], start: '2026-01-02' });

    expect(res.statusCode).toBe(401);
  });

  it('returns the rates for a single day keyed by the published day', async () => {
    vi.mocked(undici.fetch).mockResolvedValue(
      jsonResponse(200, {
        amount: 1,
        base: 'USD',
        date: '2026-01-02',
        rates: { EUR: 0.91 },
      }),
    );

    const res = await post({
      base: 'USD',
      symbols: ['EUR'],
      start: '2026-01-03',
    });

    expect(res.body).toEqual({
      status: 'ok',
      data: { base: 'USD', rates: { '2026-01-02': { EUR: 0.91 } } },
    });
    expect(vi.mocked(undici.fetch).mock.calls[0][0]).toBe(
      'https://api.frankfurter.dev/v1/2026-01-03?base=USD&symbols=EUR',
    );
  });

  it('returns the rates for a range of days', async () => {
    const rates = {
      '2026-01-02': { EUR: 0.91, GBP: 0.79 },
      '2026-01-05': { EUR: 0.92, GBP: 0.8 },
    };
    vi.mocked(undici.fetch).mockResolvedValue(
      jsonResponse(200, {
        amount: 1,
        base: 'USD',
        start_date: '2026-01-02',
        end_date: '2026-01-05',
        rates,
      }),
    );

    const res = await post({
      base: 'USD',
      symbols: ['GBP', 'EUR'],
      start: '2026-01-01',
      end: '2026-01-05',
    });

    expect(res.body).toEqual({ status: 'ok', data: { base: 'USD', rates } });
    expect(vi.mocked(undici.fetch).mock.calls[0][0]).toBe(
      'https://api.frankfurter.dev/v1/2026-01-01..2026-01-05?base=USD&symbols=EUR,GBP',
    );
  });

  it('caches responses', async () => {
    vi.mocked(undici.fetch).mockResolvedValue(
      jsonResponse(200, {
        base: 'USD',
        date: '2026-01-02',
        rates: { EUR: 0.91 },
      }),
    );

    const body = { base: 'USD', symbols: ['EUR'], start: '2026-01-02' };
    await post(body);
    const res = await post(body);

    expect(res.body.status).toBe('ok');
    expect(undici.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports currencies the provider does not cover', async () => {
    vi.mocked(undici.fetch).mockResolvedValue(
      jsonResponse(404, { message: 'not found' }),
    );

    const res = await post({
      base: 'ARS',
      symbols: ['EUR'],
      start: '2026-01-02',
    });

    expect(res.body).toEqual(
      expect.objectContaining({ status: 'error', reason: 'rates-unavailable' }),
    );
  });

  it.each([
    ['a lowercase currency', { base: 'usd' }],
    ['a currency that is not three letters', { symbols: ['EURO'] }],
    ['no symbols', { symbols: [] }],
    ['an invalid date', { start: '2026-1-2' }],
    ['an end before the start', { end: '2025-12-31' }],
    ['a range longer than a year', { end: '2027-06-01' }],
    ['a query string in the base', { base: 'USD&x=1' }],
  ])('rejects %s', async (_name, override) => {
    const res = await post({
      base: 'USD',
      symbols: ['EUR'],
      start: '2026-01-02',
      ...override,
    });

    expect(res.statusCode).toBe(400);
    expect(undici.fetch).not.toHaveBeenCalled();
  });
});
