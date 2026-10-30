import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { PostError } from '#server/errors';
import { app } from '#server/exchange-rates/app';
import { handlers as mockServerHandlers } from '#server/tests/mockSyncServer';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

// The mock server's handler map is untyped
const handlers = mockServerHandlers as Record<
  string,
  (data: { base: string; start: string; end?: string }) => unknown
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
      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-01')).toBeNull();
    });
  });

  describe('getExchangeRate', () => {
    it('returns 1 for the same currency', async () => {
      expect(await db.getExchangeRate('EUR', 'EUR', '2026-01-01')).toBe(1);
    });

    it('returns null when no rate is known for the pair', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-05',
        from_currency: 'GBP',
        to_currency: 'EUR',
        rate: 1.15,
      });

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-05')).toBeNull();
    });

    it('falls back to the earliest later rate when none is known before the date', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-05',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.9,
      });
      await app.handlers['exchange-rate-set']({
        date: '2026-01-07',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.95,
      });

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-04')).toBe(0.9);
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

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-02')).toBe(0.9);
      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-03')).toBe(0.92);
      expect(await db.getExchangeRate('USD', 'EUR', '2026-02-01')).toBe(0.92);
    });

    it('inverts a rate stored for the opposite direction', async () => {
      await app.handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'EUR',
        to_currency: 'USD',
        rate: 1.25,
      });

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.8);
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

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.79);
    });
  });

  describe('storing the same rate twice', () => {
    const rate = {
      date: '2026-01-01',
      from_currency: 'USD',
      to_currency: 'EUR',
      rate: 0.9,
    };

    it('gives the rate of a pair and day the same id on every device', async () => {
      const id = await app.handlers['exchange-rate-set'](rate);

      expect(id).toBe('USD-EUR-2026-01-01');
    });

    it('brings back a rate that was deleted', async () => {
      const id = await app.handlers['exchange-rate-set'](rate);
      await app.handlers['exchange-rate-delete']({ id });

      await app.handlers['exchange-rate-set']({ ...rate, rate: 0.8 });

      const rates = await app.handlers['exchange-rates-get']();
      expect(rates).toHaveLength(1);
      expect(rates[0]).toMatchObject({ id, rate: 0.8 });
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
      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-02')).toBe(0.91);
      expect(await db.getExchangeRate('GBP', 'EUR', '2026-01-01')).toBe(1.15);
      const rates = await app.handlers['exchange-rates-get']();
      expect(rates.every(rate => rate.source === 'api')).toBe(true);
    });

    it('tells open screens about the new rates and converted amounts', async () => {
      await setMainCurrency('EUR');
      const account = await accountsApp.handlers['account-create']({
        name: 'US',
        currency: 'USD',
      });
      await db.insertTransaction({
        account,
        amount: -1000,
        date: '2026-01-01',
      });
      handlers['/exchange-rates'] = () => ({
        base: 'USD',
        rates: { '2026-01-01': { EUR: 0.9 } },
      });
      const send = vi.spyOn(connection, 'send');

      await app.handlers['exchange-rates-fetch']({ start: '2026-01-01' });

      expect(send).toHaveBeenCalledWith('sync-event', {
        type: 'success',
        tables: ['exchange_rates', 'transactions'],
      });
      send.mockRestore();
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

      expect(await db.getExchangeRate('USD', 'EUR', '2026-01-01')).toBe(0.95);
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

  describe('exchange-rates-update', () => {
    let requests: Array<{ base: string; start: string; end?: string }>;

    beforeEach(() => {
      // Tests run on 2017-01-01
      vi.mocked(asyncStorage.getItem).mockResolvedValue('token');
      requests = [];
      handlers['/exchange-rates'] = (data: {
        base: string;
        start: string;
        end?: string;
      }) => {
        requests.push(data);
        return { base: data.base, rates: { [data.start]: { EUR: 0.9 } } };
      };
    });

    afterEach(() => {
      delete handlers['/exchange-rates'];
      vi.mocked(asyncStorage.getItem).mockReset();
    });

    async function createUsAccount() {
      await setMainCurrency('EUR');
      return accountsApp.handlers['account-create']({
        name: 'US',
        currency: 'USD',
      });
    }

    it('fetches from the first transaction when no rate was fetched yet', async () => {
      const account = await createUsAccount();
      await db.insertTransaction({ account, date: '2016-12-05', amount: 100 });
      await db.insertTransaction({ account, date: '2016-12-08', amount: 100 });

      await app.handlers['exchange-rates-update']();

      expect(requests).toEqual([
        {
          base: 'USD',
          symbols: ['EUR'],
          start: '2016-12-05',
          end: '2017-01-01',
        },
      ]);
    });

    it('fetches the days after the latest fetched rate', async () => {
      await createUsAccount();
      await app.handlers['exchange-rates-fetch']({ start: '2016-12-15' });
      // Manual rates don't count as fetched
      await app.handlers['exchange-rate-set']({
        date: '2016-12-18',
        from_currency: 'USD',
        to_currency: 'EUR',
        rate: 0.95,
      });
      requests = [];

      await app.handlers['exchange-rates-update']();

      expect(requests).toEqual([
        expect.objectContaining({ start: '2016-12-16', end: '2017-01-01' }),
      ]);
    });

    it('fetches a long history a year at a time', async () => {
      const account = await createUsAccount();
      await db.insertTransaction({ account, date: '2015-01-01', amount: 100 });

      await app.handlers['exchange-rates-update']();

      expect(requests).toEqual([
        expect.objectContaining({ start: '2015-01-01', end: '2016-01-01' }),
        expect.objectContaining({ start: '2016-01-02', end: '2017-01-01' }),
      ]);
    });

    it('does nothing when the rates are up to date', async () => {
      await createUsAccount();
      await app.handlers['exchange-rates-fetch']({ start: '2017-01-01' });
      requests = [];

      const result = await app.handlers['exchange-rates-update']();

      expect(result).toEqual({ count: 0, unavailable: [] });
      expect(requests).toEqual([]);
    });
  });
});
