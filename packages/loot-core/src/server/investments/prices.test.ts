import * as asyncStorage from '#platform/server/asyncStorage';
import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { PostError } from '#server/errors';
import { app } from '#server/investments/app';
import { handlers as mockServerHandlers } from '#server/tests/mockSyncServer';
import {
  getLatestClosingDay,
  getPriceFetchRange,
  selectPricesToStore,
} from '#shared/investments';

// The mock server's handler map is untyped
const handlers = mockServerHandlers as Record<
  string,
  (data: {
    exchange: string;
    symbol: string;
    start: string;
    end: string;
  }) => unknown
>;

// The clock in tests is fixed at 2017-01-01, a Sunday
describe('security-prices-update', () => {
  let requests: Array<{ symbol: string; start: string; end: string }>;

  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
    vi.mocked(asyncStorage.getItem).mockResolvedValue('token');
    requests = [];
    handlers['/securities/prices'] = data => {
      requests.push(data);
      return { prices: [{ date: '2016-12-30', close: 150 }] };
    };
  });

  afterEach(() => {
    delete handlers['/securities/prices'];
    vi.mocked(asyncStorage.getItem).mockReset();
  });

  async function buy(symbol = 'AAPL', exchange: 'US' | 'TSX' = 'US') {
    const account = await accountsApp.handlers['account-create']({
      name: `${symbol} ${exchange}`,
      currency: exchange === 'US' ? 'USD' : 'CAD',
      investment: true,
    });
    const security = await app.handlers['security-create']({
      symbol,
      exchange,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-12-15',
      type: 'buy',
      quantity: 10,
      price: 100,
    });
    return { account, security };
  }

  it('stores closes since the first trade and values the account', async () => {
    const { account, security } = await buy();

    const result = await app.handlers['security-prices-update']();

    expect(result).toEqual({ count: 1, problems: {}, unavailable: [] });
    expect(requests).toEqual([
      {
        exchange: 'US',
        symbol: 'AAPL',
        start: '2016-12-15',
        end: '2017-01-01',
      },
    ]);
    const [price] = await app.handlers['security-prices-get']({ security });
    expect(price).toMatchObject({ close: 150, source: 'api' });
    const { holdings } = await app.handlers['holdings-get']({ account });
    expect(holdings[0].marketValue).toBe(150000);
    expect(
      await accountsApp.handlers['account-balance']({
        id: account,
        cutoff: new Date('2027-01-01'),
      }),
    ).toBe(-100000 + 150000);
  });

  it("doesn't ask again once it has the latest close", async () => {
    await buy();
    await app.handlers['security-prices-update']();
    await app.handlers['security-prices-update']();
    expect(requests).toHaveLength(1);
  });

  it('keeps a price entered by hand', async () => {
    const { security } = await buy();
    await app.handlers['security-price-set']({
      security,
      date: '2016-12-30',
      close: 99,
    });

    await app.handlers['security-prices-update']();

    const [price] = await app.handlers['security-prices-get']({ security });
    expect(price).toMatchObject({ close: 99, source: 'manual' });
  });

  it('stops asking an exchange after a problem with its key', async () => {
    await buy('AAPL');
    await buy('MSFT');
    await buy('SHOP', 'TSX');
    handlers['/securities/prices'] = data => {
      requests.push(data);
      if (data.exchange === 'US') {
        throw new PostError('rate-limited');
      }
      return { prices: [] };
    };

    const result = await app.handlers['security-prices-update']();

    expect(result).toEqual({
      count: 0,
      problems: { US: 'rate-limited' },
      unavailable: [],
    });
    expect(requests.map(request => request.symbol).sort()).toEqual([
      expect.any(String),
      'SHOP',
    ]);
  });

  it('carries on past a symbol the provider does not know', async () => {
    await buy('NOPE');
    await buy('AAPL');
    handlers['/securities/prices'] = data => {
      if (data.symbol === 'NOPE') {
        throw new PostError('unknown-symbol');
      }
      return { prices: [{ date: '2016-12-30', close: 150 }] };
    };

    expect(await app.handlers['security-prices-update']()).toEqual({
      count: 1,
      problems: {},
      unavailable: ['NOPE'],
    });
  });

  it("doesn't ask again the same day after nothing new came in", async () => {
    await buy();
    handlers['/securities/prices'] = data => {
      requests.push(data);
      return { prices: [] };
    };

    await app.handlers['security-prices-update']();
    await app.handlers['security-prices-update']();

    expect(requests).toHaveLength(1);
  });

  it('keeps reporting an unknown symbol without asking again', async () => {
    await buy('NOPE');
    handlers['/securities/prices'] = data => {
      requests.push(data);
      throw new PostError('unknown-symbol');
    };

    await app.handlers['security-prices-update']();
    const result = await app.handlers['security-prices-update']();

    expect(requests).toHaveLength(1);
    expect(result).toEqual({ count: 0, problems: {}, unavailable: ['NOPE'] });
  });

  it('asks again after a problem with the key', async () => {
    await buy();
    handlers['/securities/prices'] = data => {
      requests.push(data);
      throw new PostError('rate-limited');
    };

    await app.handlers['security-prices-update']();
    await app.handlers['security-prices-update']();

    expect(requests).toHaveLength(2);
  });

  it('skips closed accounts', async () => {
    const { account } = await buy();
    await db.update('accounts', { id: account, closed: 1 });

    await app.handlers['security-prices-update']();

    expect(requests).toEqual([]);
  });

  it('rolls value over without a server', async () => {
    const { account } = await buy();
    vi.mocked(asyncStorage.getItem).mockResolvedValue(undefined);

    expect(await app.handlers['security-prices-update']()).toEqual({
      error: 'unauthorized',
    });

    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(t => t.investment_type === 'market-value')?.amount,
    ).toBe(100000);
  });
});

describe('security-close-get', () => {
  let requests: Array<{ symbol: string; start: string; end: string }>;

  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
    vi.mocked(asyncStorage.getItem).mockResolvedValue('token');
    requests = [];
    handlers['/securities/prices'] = data => {
      requests.push(data);
      return {
        prices: [
          { date: '2016-12-29', close: 148 },
          { date: '2016-12-30', close: 150 },
        ],
      };
    };
  });

  afterEach(() => {
    delete handlers['/securities/prices'];
    vi.mocked(asyncStorage.getItem).mockReset();
  });

  it('uses the last close on or before a weekend day', async () => {
    const result = await app.handlers['security-close-get']({
      exchange: 'US',
      symbol: 'nflx',
      date: '2016-12-31',
    });

    expect(result).toEqual({ date: '2016-12-30', close: 150 });
    expect(requests).toEqual([
      {
        exchange: 'US',
        symbol: 'NFLX',
        start: '2016-12-25',
        end: '2016-12-31',
      },
    ]);
  });

  it("doesn't ask the server for a close already stored", async () => {
    const security = await app.handlers['security-create']({
      symbol: 'NFLX',
      exchange: 'US',
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-12-30',
      close: 99,
    });

    const result = await app.handlers['security-close-get']({
      exchange: 'US',
      symbol: 'NFLX',
      date: '2016-12-30',
    });

    expect(result).toEqual({ date: '2016-12-30', close: 99 });
    expect(requests).toHaveLength(0);
  });

  it('falls back to a stored close when the server fails', async () => {
    const security = await app.handlers['security-create']({
      symbol: 'NFLX',
      exchange: 'US',
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-12-28',
      close: 140,
    });
    handlers['/securities/prices'] = () => {
      throw new PostError('rate-limited');
    };

    expect(
      await app.handlers['security-close-get']({
        exchange: 'US',
        symbol: 'NFLX',
        date: '2016-12-30',
      }),
    ).toEqual({ date: '2016-12-28', close: 140 });
    expect(
      await app.handlers['security-close-get']({
        exchange: 'US',
        symbol: 'MSFT',
        date: '2016-12-30',
      }),
    ).toEqual({ error: 'rate-limited' });
  });

  it('says when there is no close', async () => {
    handlers['/securities/prices'] = data => {
      requests.push(data);
      return { prices: [] };
    };

    const result = await app.handlers['security-close-get']({
      exchange: 'TSX',
      symbol: 'SHOP',
      date: '2016-01-15',
    });

    expect(result).toEqual({ error: 'no-close' });
  });

  it("doesn't look up future dates or bad symbols", async () => {
    for (const request of [
      { symbol: 'NFLX', date: '2017-01-02' },
      { symbol: '', date: '2016-12-30' },
      { symbol: 'NFLX', date: '2016-02-30' },
    ]) {
      expect(
        await app.handlers['security-close-get']({
          exchange: 'US',
          ...request,
        }),
      ).toEqual({ error: 'no-close' });
    }
    expect(requests).toHaveLength(0);
  });

  it('needs a server for closes not stored', async () => {
    vi.mocked(asyncStorage.getItem).mockResolvedValue(undefined);

    const result = await app.handlers['security-close-get']({
      exchange: 'US',
      symbol: 'NFLX',
      date: '2016-12-30',
    });

    expect(result).toEqual({ error: 'unauthorized' });
  });
});

describe('getLatestClosingDay', () => {
  it.each([
    ['2026-11-03', '2026-11-02'], // Tuesday
    ['2026-11-02', '2026-10-30'], // Monday
    ['2026-11-01', '2026-10-30'], // Sunday
    ['2026-10-31', '2026-10-30'], // Saturday
  ])('on %s is %s', (today, expected) => {
    expect(getLatestClosingDay(today)).toBe(expected);
  });
});

describe('getPriceFetchRange', () => {
  const base = {
    firstTrade: '2026-01-05',
    lastTrade: '2026-01-05',
    earliestFetched: null,
    latestFetched: null,
    isHeld: true,
    today: '2026-11-03',
  };

  it('starts at the first trade', () => {
    expect(getPriceFetchRange(base)).toEqual({
      start: '2026-01-05',
      end: '2026-11-03',
    });
  });

  it('continues after the latest close, until it is up to date', () => {
    const fetched = { ...base, earliestFetched: '2026-01-05' };
    expect(
      getPriceFetchRange({ ...fetched, latestFetched: '2026-10-29' }),
    ).toEqual({ start: '2026-10-30', end: '2026-11-03' });
    expect(
      getPriceFetchRange({ ...fetched, latestFetched: '2026-11-02' }),
    ).toBeNull();
  });

  it('accepts a first close later in the month than the first trade', () => {
    expect(
      getPriceFetchRange({
        ...base,
        earliestFetched: '2026-01-30',
        latestFetched: '2026-11-02',
      }),
    ).toBeNull();
  });

  it('goes back for a backdated trade', () => {
    const backdated = {
      ...base,
      earliestFetched: '2026-02-01',
      latestFetched: '2026-11-02',
    };
    expect(getPriceFetchRange(backdated)).toEqual({
      start: '2026-01-05',
      end: '2026-11-03',
    });
  });

  it('stops at the last trade of a sold out security', () => {
    const soldOut = { ...base, isHeld: false, lastTrade: '2026-03-01' };
    expect(getPriceFetchRange(soldOut)).toEqual({
      start: '2026-01-05',
      end: '2026-03-01',
    });
    expect(
      getPriceFetchRange({
        ...soldOut,
        earliestFetched: '2026-01-05',
        latestFetched: '2026-03-01',
      }),
    ).toBeNull();
  });
});

describe('selectPricesToStore', () => {
  it('keeps month ends of old history and every recent close', () => {
    const prices = [
      '2026-01-29',
      '2026-01-30',
      '2026-02-26',
      '2026-02-27',
      '2026-10-29',
      '2026-10-30',
    ].map(date => ({ date, close: 1 }));

    expect(
      selectPricesToStore(prices, '2026-11-03').map(price => price.date),
    ).toEqual(['2026-01-30', '2026-02-27', '2026-10-29', '2026-10-30']);
  });
});
