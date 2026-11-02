import request from 'supertest';
import * as undici from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers as app, clearSecuritiesCache } from './app-securities';
import { secretsService } from './services/secrets-service';

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

const post = (path: string, body: object) =>
  request(app).post(path).set('x-actual-token', 'valid-token').send(body);

const prices = (exchange: string, symbol: string) =>
  post('/prices', {
    exchange,
    symbol,
    start: '2026-01-01',
    end: '2026-01-31',
  });

const fetchedUrl = () => String(vi.mocked(undici.fetch).mock.calls[0][0]);

describe('app-securities', () => {
  beforeEach(() => {
    clearSecuritiesCache();
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    vi.spyOn(secretsService, 'get').mockImplementation(name =>
      name === 'tiingo_token' ? 'tiingo-secret' : 'alpha-secret',
    );
    vi.spyOn(secretsService, 'exists').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(undici.fetch).mockReset();
  });

  it('requires a session', async () => {
    const res = await request(app).post('/status').send({});
    expect(res.statusCode).toBe(401);
  });

  it('reports which exchanges have a key', async () => {
    vi.mocked(secretsService.exists).mockImplementation(
      name => name === 'tiingo_token',
    );
    const res = await post('/status', {});
    expect(res.body.data).toEqual({ US: true, TSX: true });
  });

  it.each([
    [{ exchange: 'LSE', symbol: 'A', start: '2026-01-01', end: '2026-01-02' }],
    [
      {
        exchange: 'US',
        symbol: '../x',
        start: '2026-01-01',
        end: '2026-01-02',
      },
    ],
    [{ exchange: 'US', symbol: 'A', start: 'soon', end: '2026-01-02' }],
    [{ exchange: 'US', symbol: 'A', start: '2026-01-03', end: '2026-01-02' }],
  ])('rejects the invalid request %j', async body => {
    const res = await post('/prices', body);
    expect(res.statusCode).toBe(400);
    expect(undici.fetch).not.toHaveBeenCalled();
  });

  describe('Tiingo', () => {
    it('returns as-traded closes by day, with the key in a header', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(200, [
          {
            date: '2026-01-02T00:00:00.000Z',
            close: 100,
            adjClose: 50,
            splitFactor: 1,
          },
        ]),
      );

      const res = await prices('US', 'AAPL');

      expect(res.body).toEqual({
        status: 'ok',
        data: { prices: [{ date: '2026-01-02', close: 100 }] },
      });
      expect(fetchedUrl()).toBe(
        'https://api.tiingo.com/tiingo/daily/aapl/prices?startDate=2026-01-01&endDate=2026-01-31',
      );
      expect(fetchedUrl()).not.toContain('tiingo-secret');
      expect(vi.mocked(undici.fetch).mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Token tiingo-secret',
      });
    });

    it('reports a split on the day it happens', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(200, [
          { date: '2026-01-02T00:00:00.000Z', close: 400, splitFactor: 1 },
          { date: '2026-01-05T00:00:00.000Z', close: 100, splitFactor: 4 },
        ]),
      );

      const res = await prices('US', 'AAPL');

      expect(res.body.data.prices).toEqual([
        { date: '2026-01-02', close: 400 },
        { date: '2026-01-05', close: 100, splitFactor: 4 },
      ]);
    });

    it('writes share classes the way Tiingo does', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(200, []));
      await prices('US', 'BRK.B');
      expect(fetchedUrl()).toContain('/daily/brk-b/prices');
    });

    it('asks once for the same range', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(200, []));
      await prices('US', 'AAPL');
      await prices('US', 'AAPL');
      expect(undici.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      [403, 'invalid-key'],
      [404, 'unknown-symbol'],
      [429, 'rate-limited'],
      [500, 'prices-unavailable'],
    ])('reports a %i as %s', async (status, reason) => {
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(status, { detail: 'tiingo-secret' }),
      );
      const res = await prices('US', 'AAPL');
      expect(res.body).toEqual({ status: 'error', reason });
    });

    it('remembers an unknown symbol but retries other failures', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(404, {}));
      await prices('US', 'NOPE');
      await prices('US', 'NOPE');
      expect(undici.fetch).toHaveBeenCalledTimes(1);

      vi.mocked(undici.fetch).mockClear();
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(500, {}));
      await prices('US', 'AAPL');
      await prices('US', 'AAPL');
      expect(undici.fetch).toHaveBeenCalledTimes(2);
    });

    it('reports a missing token without asking Tiingo', async () => {
      vi.mocked(secretsService.get).mockReturnValue(null);
      const res = await prices('US', 'AAPL');
      expect(res.body.reason).toBe('not-configured');
      expect(undici.fetch).not.toHaveBeenCalled();
    });

    it('reports a network failure', async () => {
      vi.mocked(undici.fetch).mockRejectedValue(new Error('down'));
      const res = await prices('US', 'AAPL');
      expect(res.body.reason).toBe('prices-unavailable');
    });

    it('finds active listings, leaving out Chinese ones', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(200, [
          { ticker: 'aapl', name: 'Apple Inc', isActive: true },
          { ticker: 'gone', name: 'Delisted', isActive: false },
          { ticker: '000001', name: 'Ping An', isActive: true },
        ]),
      );

      const res = await post('/search', { exchange: 'US', query: 'apple' });

      expect(res.body.data.results).toEqual([
        { symbol: 'AAPL', name: 'Apple Inc' },
      ]);
    });
  });

  describe('Yahoo', () => {
    // Each day is dated by when the market opened in Toronto
    const JAN_2 = 1767364200;
    const JAN_5 = 1767623400;
    const JAN_6 = 1767709800;
    const MAR_2 = 1772461800;

    // Yahoo divides what came before each split by its ratio: these traded at
    // 800, 808, 404 and 100, with a 2-for-1 split on Jan 6 and a 4-for-1 on
    // Mar 2
    const chart = (meta: object = {}) => ({
      chart: {
        result: [
          {
            meta,
            timestamp: [JAN_2, JAN_5, JAN_6, MAR_2],
            indicators: { quote: [{ close: [100, 101.000001, 101, 100] }] },
            events: {
              splits: {
                [JAN_6]: { date: JAN_6, numerator: 2, denominator: 1 },
                [MAR_2]: { date: MAR_2, numerator: 4, denominator: 1 },
              },
            },
          },
        ],
        error: null,
      },
    });

    it('returns as-traded closes and splits in the range', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(200, chart()));

      const res = await prices('TSX', 'SHOP');

      expect(res.body.data.prices).toEqual([
        { date: '2026-01-02', close: 800 },
        { date: '2026-01-05', close: 808 },
        { date: '2026-01-06', close: 404, splitFactor: 2 },
      ]);
      expect(fetchedUrl()).toContain('/v8/finance/chart/SHOP.TO?');
      expect(fetchedUrl()).toContain('events=split');
      expect(vi.mocked(undici.fetch).mock.calls[0][1]?.headers).toMatchObject({
        'User-Agent': expect.any(String),
      });
    });

    it('writes share classes the way Yahoo does', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(200, chart()));
      await prices('TSX', 'CTC.A');
      expect(fetchedUrl()).toContain('/CTC-A.TO?');
    });

    it("leaves out today's close until it is final", async () => {
      // 20 minutes after the close on Jan 6
      vi.spyOn(Date, 'now').mockReturnValue((JAN_6 + 6.5 * 3600 + 1200) * 1000);
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(
          200,
          chart({
            currentTradingPeriod: { regular: { end: JAN_6 + 6.5 * 3600 } },
          }),
        ),
      );

      const res = await prices('TSX', 'SHOP');

      expect(res.body.data.prices.map((p: { date: string }) => p.date)).toEqual(
        ['2026-01-02', '2026-01-05'],
      );
    });

    it.each([
      [404, {}, 'unknown-symbol'],
      [
        200,
        { chart: { result: null, error: { code: 'Not Found' } } },
        'unknown-symbol',
      ],
      [429, {}, 'rate-limited'],
      [401, {}, 'prices-unavailable'],
      [200, { chart: { result: [] } }, 'prices-unavailable'],
    ])('reports a %i with %j as %s', async (status, body, reason) => {
      vi.mocked(undici.fetch).mockResolvedValue(jsonResponse(status, body));
      const res = await prices('TSX', 'SHOP');
      expect(res.body).toEqual({ status: 'error', reason });
    });

    it('only finds Toronto listings', async () => {
      vi.mocked(undici.fetch).mockResolvedValue(
        jsonResponse(200, {
          quotes: [
            { symbol: 'SHOP', exchange: 'NYQ', longname: 'Shopify (US)' },
            { symbol: 'SHOP.TO', exchange: 'TOR', longname: 'Shopify Inc.' },
            { symbol: 'CTC-A.TO', exchange: 'TOR', shortname: 'CDN TIRE' },
          ],
        }),
      );

      const res = await post('/search', { exchange: 'TSX', query: 'shopify' });

      expect(res.body.data.results).toEqual([
        { symbol: 'SHOP', name: 'Shopify Inc.' },
        { symbol: 'CTC.A', name: 'CDN TIRE' },
      ]);
    });

    it('needs no key for Toronto', async () => {
      vi.mocked(secretsService.exists).mockReturnValue(false);
      const res = await post('/status', {});
      expect(res.body.data).toEqual({ US: false, TSX: true });
    });
  });
});
