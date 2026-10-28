import * as asyncStorage from '#platform/server/asyncStorage';
import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { PostError } from '#server/errors';
import { app, getExchangeRate } from '#server/exchange-rates/app';
import { handlers as mockServerHandlers } from '#server/tests/mockSyncServer';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

// The mock server's handler map is untyped
const handlers = mockServerHandlers as Record<
  string,
  (data: { base: string }) => unknown
>;

async function setMainCurrency(code: string) {
  await db.run('INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)', [
    'defaultCurrencyCode',
    code,
  ]);
}

describe('exchange rates app', () => {
  describe('exchange-rate-set / exchange-rates-get', () => {
    it('stores rates and returns them newest first', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-02',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.91,
        source: 'api',
      });

      const rates = await app.handlers['exchange-rates-get']();
      expect(rates).toEqual([
        expect.objectContaining({
          date: '2026-01-02',
          from_currency: 'USD',
          to_currency: 'EUR',
          rate: 0.91,
          source: 'api',
        }),
        expect.objectContaining({
          date: '2026-01-01',
          rate: 0.9,
          source: 'manual',
        }),
      ]);
    });

    it('filters by currency pair', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'GBP',
        to_currency: 'EUR',
        rate: 1.15,
      });

      const rates = await app.handlers['exchange-rates-get']({
        from_currency: 'GBP',
      });
      expect(rates.map(rate => rate.from_currency)).toEqual(['GBP']);
    });

    it('replaces the rate already stored for the same day', async () => {
      const id = await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
        source: 'api',
      });
      const sameId = await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.95,
      });

      expect(sameId).toBe(id);
      const rates = await app.handlers['exchange-rates-get']();
      expect(rates).toEqual([
        expect.objectContaining({ id, rate: 0.95, source: 'manual' }),
      ]);
    });

    it('does not let an API rate replace a manual one', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.95,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
        source: 'api',
      });

      const rates = await app.handlers['exchange-rates-get']();
      expect(rates).toEqual([
        expect.objectContaining({ rate: 0.95, source: 'manual' }),
      ]);
    });

    it.each([
      ['an unknown currency', { from_currency: 'XXX' }, /unknown currency/],
      ['the same currency twice', { to_currency: 'USD' }, /two different/],
      ['an invalid date', { date: '2026-13-01' }, /invalid date/],
      ['a zero rate', { rate: 0 }, /positive number/],
      ['a negative rate', { rate: -1 }, /positive number/],
    ])('rejects %s', async (_name, override, error) => {
      await expect(
        app.handlers['exchange-rate-set']({
          date: '2026-01-01',
          from_currency: 'USD',
          to_currency: 'EUR',
          rate: 0.9,
          ...override,
        }),
      ).rejects.toThrow(error);
    });
  });

  describe('exchange-rate-delete', () => {
    it('removes the rate', async () => {
      const id = await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });
      await app.handlers['exchange-rate-delete']({ id });

      expect(await app.handlers['exchange-rates-get']()).toEqual([]);
      expect(await getExchangeRate('USD', 'EUR', '2026-01-01')).toBeNull();
    });
  });

  describe('getExchangeRate', () => {
    it('returns 1 for the same currency', async () => {
      expect(await getExchangeRate('EUR', 'EUR', '2026-01-01')).toBe(1);
    });

    it('returns null when no rate is known on or before the date', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-05',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });

      expect(await getExchangeRate('USD', 'EUR', '2026-01-04')).toBeNull();
    });

    it('uses the latest rate on or before the date', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-03',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.92,
      });

      expect(await getExchangeRate('USD', 'EUR', '2026-01-02')).toBe(0.9);
      expect(await getExchangeRate('USD', 'EUR', '2026-01-03')).toBe(0.92);
      expect(await getExchangeRate('USD', 'EUR', '2026-02-01')).toBe(0.92);
    });

    it('inverts a rate stored for the opposite direction', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'EUR',
        to_currency: 'USD',
        rate: 1.25,
      });

      expect(await getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.8);
    });

    it('prefers the direct rate when both directions exist on the same day', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'EUR',
        to_currency: 'USD',
        rate: 1.25,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.79,
      });

      expect(await getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.79);
    });
  });

  describe('exchange-rates-fetch', () => {
    beforeEach(() => {
      vi.mocked(asyncStorage.getItem).mockResolvedValue('token');
    });

    afterEach(() => {
      delete handlers['/exchange-rates'];
      vi.mocked(asyncStorage.getItem).mockReset();
    });

    it('fetches and stores rates from each foreign currency to the main one', async () => {
      await setMainCurrency('EUR');
      await accountsApp.handlers['account-create']({ name: 'Main' });
      await accountsApp.handlers['account-create']({
        name: 'US',
        currency: 'USD',
      });
      await accountsApp.handlers['account-create']({
        name: 'UK',
        currency: 'GBP',
      });
      await accountsApp.handlers['account-create']({
        name: 'Also main',
        currency: 'EUR',
      });

      const requests: unknown[] = [];
      handlers['/exchange-rates'] = (data: { base: string }) => {
        requests.push(data);
        return {
          base: data.base,
          rates: {
            '2026-01-01': { EUR: data.base === 'USD' ? 0.9 : 1.15 },
            '2026-01-02': { EUR: data.base === 'USD' ? 0.91 : 1.16 },
          },
        };
      };

      const result = await app.handlers['exchange-rates-fetch']({
        start: '2026-01-01',
        end: '2026-01-02',
      });

      expect(result).toEqual({ count: 4, unavailable: [] });
      expect(requests).toEqual([
        {
          base: 'GBP',
          symbols: ['EUR'],
          start: '2026-01-01',
          end: '2026-01-02',
        },
        {
          base: 'USD',
          symbols: ['EUR'],
          start: '2026-01-01',
          end: '2026-01-02',
        },
      ]);
      expect(await getExchangeRate('USD', 'EUR', '2026-01-02')).toBe(0.91);
      expect(await getExchangeRate('GBP', 'EUR', '2026-01-01')).toBe(1.15);
      const rates = await app.handlers['exchange-rates-get']();
      expect(rates.every(rate => rate.source === 'api')).toBe(true);
    });

    it('keeps manual rates', async () => {
      await setMainCurrency('EUR');
      await accountsApp.handlers['account-create']({
        name: 'US',
        currency: 'USD',
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.95,
      });
      handlers['/exchange-rates'] = () => ({
        base: 'USD',
        rates: { '2026-01-01': { EUR: 0.9 } },
      });

      await app.handlers['exchange-rates-fetch']({ start: '2026-01-01' });

      expect(await getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.95);
    });

    it('lists currencies the provider does not cover', async () => {
      await setMainCurrency('EUR');
      await accountsApp.handlers['account-create']({
        name: 'AR',
        currency: 'ARS',
      });
      await accountsApp.handlers['account-create']({
        name: 'US',
        currency: 'USD',
      });
      handlers['/exchange-rates'] = (data: { base: string }) => {
        if (data.base === 'ARS') {
          throw new PostError('rates-unavailable');
        }
        return { base: 'USD', rates: { '2026-01-01': { EUR: 0.9 } } };
      };

      const result = await app.handlers['exchange-rates-fetch']({
        start: '2026-01-01',
      });

      expect(result).toEqual({ count: 1, unavailable: ['ARS'] });
    });

    it('needs a main currency', async () => {
      const result = await app.handlers['exchange-rates-fetch']({
        start: '2026-01-01',
      });

      expect(result).toEqual({ error: 'no-main-currency' });
    });

    it('needs the user to be signed in', async () => {
      vi.mocked(asyncStorage.getItem).mockResolvedValue(undefined);

      const result = await app.handlers['exchange-rates-fetch']({
        start: '2026-01-01',
      });

      expect(result).toEqual({ error: 'unauthorized' });
    });
  });
});
