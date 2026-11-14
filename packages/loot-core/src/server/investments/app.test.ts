import { app as accountsApp } from '#server/accounts/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app } from '#server/investments/app';
import { batchUpdateTransactions } from '#server/transactions';
import {
  calculateHolding,
  getMarketValueChanges,
  getPerformanceHistory,
  getTradeCashAmount,
  NOT_INVESTMENT_ACTIVITY,
  sellsMoreThanHeld,
} from '#shared/investments';
import { q } from '#shared/query';
import type { PerformanceMonth, TradeType } from '#types/models';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

function createInvestmentAccount(currency = 'USD') {
  return accountsApp.handlers['account-create']({
    name: `${currency} brokerage`,
    currency,
    investment: true,
  });
}

function createAapl() {
  return app.handlers['security-create']({
    symbol: 'AAPL',
    exchange: 'US',
    name: 'Apple',
  });
}

async function getBalance(account: string) {
  return accountsApp.handlers['account-balance']({
    id: account,
    cutoff: new Date('2027-01-01'),
  });
}

describe('investments app', () => {
  describe('investment accounts', () => {
    it('are always off budget', async () => {
      const id = await createInvestmentAccount();
      const account = await db.first<db.DbAccount>(
        'SELECT * FROM accounts WHERE id = ?',
        [id],
      );
      expect(account).toMatchObject({
        investment: 1,
        offbudget: 1,
        currency: 'USD',
      });
    });

    it('need a currency securities are traded in', async () => {
      await expect(
        accountsApp.handlers['account-create']({
          name: 'No currency',
          investment: true,
        }),
      ).rejects.toThrow('needs a currency');
      await expect(createInvestmentAccount('EUR')).rejects.toThrow(
        'needs a currency',
      );
    });

    it("can't change currency", async () => {
      const id = await createInvestmentAccount();
      await expect(
        accountsApp.handlers['account-update']({ id, currency: 'CAD' }),
      ).rejects.toThrow("can't be changed");
    });

    it('leave other accounts free to change currency', async () => {
      const id = await accountsApp.handlers['account-create']({ name: 'Bank' });
      await accountsApp.handlers['account-update']({ id, currency: 'CAD' });
      const account = await db.first<db.DbAccount>(
        'SELECT * FROM accounts WHERE id = ?',
        [id],
      );
      expect(account?.currency).toBe('CAD');
      expect(account?.investment).toBe(0);
    });

    it("can't be closed while they hold shares", async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const trade = {
        account,
        security,
        quantity: 10,
        price: 100,
        fee: 0,
      };
      await app.handlers['trade-create']({
        ...trade,
        date: '2026-01-02',
        type: 'buy',
      });
      await expect(
        accountsApp.handlers['account-close']({ id: account }),
      ).rejects.toThrow('still holds shares');

      // Selling at the price paid leaves no cash to move out
      await app.handlers['trade-create']({
        ...trade,
        date: '2026-02-02',
        type: 'sell',
      });
      await accountsApp.handlers['account-close']({ id: account });
      const closed = await db.first<db.DbAccount>(
        'SELECT * FROM accounts WHERE id = ?',
        [account],
      );
      expect(closed?.closed).toBe(1);
    });
  });

  describe('securities', () => {
    it('takes the currency from the exchange', async () => {
      await createAapl();
      await app.handlers['security-create']({ symbol: 'ry', exchange: 'TSX' });

      expect(await app.handlers['securities-get']()).toEqual([
        {
          id: 'US-AAPL',
          symbol: 'AAPL',
          exchange: 'US',
          name: 'Apple',
          currency: 'USD',
        },
        {
          id: 'TSX-RY',
          symbol: 'RY',
          exchange: 'TSX',
          name: null,
          currency: 'CAD',
        },
      ]);
    });

    it('keeps listings on different exchanges apart', async () => {
      const us = await app.handlers['security-create']({
        symbol: 'RY',
        exchange: 'US',
      });
      const tsx = await app.handlers['security-create']({
        symbol: 'RY',
        exchange: 'TSX',
      });
      expect(us).not.toBe(tsx);
    });

    it('keeps one row when added twice', async () => {
      await createAapl();
      await createAapl();
      expect(await app.handlers['securities-get']()).toHaveLength(1);
    });

    it('rejects invalid symbols and exchanges', async () => {
      await expect(
        app.handlers['security-create']({ symbol: 'A B', exchange: 'US' }),
      ).rejects.toThrow('invalid symbol');
      await expect(
        app.handlers['security-create']({
          symbol: 'AAPL',
          // @ts-expect-error testing an unknown exchange
          exchange: 'LSE',
        }),
      ).rejects.toThrow('unknown exchange');
    });
  });

  describe('security prices', () => {
    it('stores one price per day, newest first', async () => {
      const security = await createAapl();
      const set = app.handlers['security-price-set'];
      await set({ security, date: '2026-01-01', close: 100 });
      await set({ security, date: '2026-01-02', close: 101 });
      await set({ security, date: '2026-01-02', close: 102 });

      const prices = await app.handlers['security-prices-get']({ security });
      expect(prices.map(price => [price.date, price.close])).toEqual([
        ['2026-01-02', 102],
        ['2026-01-01', 100],
      ]);
    });

    it('keeps a manual price when a fetched one arrives', async () => {
      const security = await createAapl();
      const set = app.handlers['security-price-set'];
      await set({ security, date: '2026-01-01', close: 100 });
      await set({ security, date: '2026-01-01', close: 200, source: 'api' });

      const [price] = await app.handlers['security-prices-get']({ security });
      expect(price).toMatchObject({ close: 100, source: 'manual' });
    });

    it('brings back a deleted price when it is set again', async () => {
      const security = await createAapl();
      const set = app.handlers['security-price-set'];
      const id = await set({ security, date: '2026-01-01', close: 100 });
      await app.handlers['security-price-delete']({ id });
      expect(await app.handlers['security-prices-get']({ security })).toEqual(
        [],
      );

      await set({ security, date: '2026-01-01', close: 200, source: 'api' });
      const [price] = await app.handlers['security-prices-get']({ security });
      expect(price).toMatchObject({ close: 200, source: 'api' });
    });

    it('rejects invalid prices', async () => {
      const security = await createAapl();
      const set = app.handlers['security-price-set'];
      await expect(
        set({ security, date: '2026-01-01', close: 0 }),
      ).rejects.toThrow('positive');
      await expect(set({ security, date: 'soon', close: 1 })).rejects.toThrow(
        'invalid date',
      );
      await expect(
        set({ security: 'US-NOPE', date: '2026-01-01', close: 1 }),
      ).rejects.toThrow('does not exist');
    });
  });

  describe('trades', () => {
    it('moves cash with a transaction on each trade', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();

      await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 10,
        price: 100,
        fee: 500,
      });
      expect(await getBalance(account)).toBe(-100500);

      await app.handlers['trade-create']({
        account,
        security,
        date: '2026-02-02',
        type: 'sell',
        quantity: 4,
        price: 150,
        fee: 500,
      });
      expect(await getBalance(account)).toBe(-100500 + 59500);

      const transactions = await db.getTransactions(account);
      expect(
        transactions
          .map(transaction => transaction.notes)
          .sort((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(['Buy 10 AAPL @ 100', 'Sell 4 AAPL @ 150']);
    });

    it('updates the transaction with the trade', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const id = await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 10,
        price: 100,
      });

      await app.handlers['trade-update']({
        id,
        date: '2026-01-05',
        quantity: 5,
      });

      const [trade] = await app.handlers['trades-get']({ account });
      expect(trade).toMatchObject({
        date: '2026-01-05',
        quantity: 5,
        price: 100,
      });
      const [transaction] = await db.getTransactions(account);
      expect(transaction).toMatchObject({
        date: '2026-01-05',
        amount: -50000,
        notes: 'Buy 5 AAPL @ 100',
      });
    });

    it('brings back a transaction deleted from the account', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const id = await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 10,
        price: 100,
      });
      const [transaction] = await db.getTransactions(account);
      await db.deleteTransaction({ id: transaction.id });
      expect(await getBalance(account)).toBe(0);

      await app.handlers['trade-update']({ id, price: 110 });

      expect(await getBalance(account)).toBe(-110000);
    });

    it('removes the transaction with the trade', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const id = await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 10,
        price: 100,
      });

      await app.handlers['trade-delete']({ id });

      expect(await app.handlers['trades-get']({ account })).toEqual([]);
      expect(await getBalance(account)).toBe(0);
    });

    it('stores converted amounts for the main currency', async () => {
      await db.run(
        'INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)',
        ['defaultCurrencyCode', 'CAD'],
      );
      await db.insert('exchange_rates', {
        id: 'USD-CAD-2026-01-01',
        date: 20260101,
        from_currency: 'USD',
        to_currency: 'CAD',
        rate: 1.4,
        source: 'manual',
        tombstone: 0,
      });
      const account = await createInvestmentAccount();
      const security = await createAapl();

      await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 10,
        price: 100,
      });

      const [transaction] = await db.getTransactions(account);
      expect(transaction).toMatchObject({
        amount: -100000,
        converted_amount: -140000,
      });
    });

    it('allows selling everything with fractional shares', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const trade = {
        account,
        security,
        date: '2026-01-02',
        price: 100,
      };
      const create = app.handlers['trade-create'];
      await create({ ...trade, type: 'buy', quantity: 0.1 });
      await create({ ...trade, type: 'buy', quantity: 0.2 });
      await create({ ...trade, type: 'sell', quantity: 0.3 });

      expect(await app.handlers['trades-get']({ account })).toHaveLength(3);
    });

    it('rejects selling more than is held', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const create = app.handlers['trade-create'];
      const trade = { account, security, price: 100 };
      await create({
        ...trade,
        date: '2026-02-01',
        type: 'buy',
        quantity: 10,
      });

      await expect(
        create({ ...trade, date: '2026-02-02', type: 'sell', quantity: 11 }),
      ).rejects.toThrow('more shares than are held');
      // Enough shares are held later, but not on the day of the sell
      await expect(
        create({ ...trade, date: '2026-01-15', type: 'sell', quantity: 1 }),
      ).rejects.toThrow('more shares than are held');
    });

    it("won't update or delete a buy that later sells rely on", async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const create = app.handlers['trade-create'];
      const trade = { account, security, price: 100 };
      const buy = await create({
        ...trade,
        date: '2026-01-01',
        type: 'buy',
        quantity: 10,
      });
      await create({
        ...trade,
        date: '2026-01-02',
        type: 'sell',
        quantity: 8,
      });

      await expect(
        app.handlers['trade-update']({ id: buy, quantity: 5 }),
      ).rejects.toThrow('more shares than are held');
      await expect(app.handlers['trade-delete']({ id: buy })).rejects.toThrow(
        'more shares than are held',
      );
    });

    it('needs an open investment account in the right currency', async () => {
      const security = await createAapl();
      const trade = {
        security,
        date: '2026-01-02',
        type: 'buy' as const,
        quantity: 1,
        price: 100,
      };
      const create = app.handlers['trade-create'];

      const bank = await accountsApp.handlers['account-create']({
        name: 'Bank',
        currency: 'USD',
      });
      await expect(create({ ...trade, account: bank })).rejects.toThrow(
        'not an investment account',
      );

      const cad = await createInvestmentAccount('CAD');
      await expect(create({ ...trade, account: cad })).rejects.toThrow(
        'needs a USD account',
      );

      const closed = await createInvestmentAccount();
      await db.update('accounts', { id: closed, closed: 1 });
      await expect(create({ ...trade, account: closed })).rejects.toThrow(
        'is closed',
      );
    });

    it('rejects invalid trades', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      const trade = {
        account,
        security,
        date: '2026-01-02',
        type: 'buy' as const,
        quantity: 1,
        price: 100,
      };
      const create = app.handlers['trade-create'];

      await expect(create({ ...trade, quantity: 0 })).rejects.toThrow(
        'quantity must be a positive number',
      );
      await expect(create({ ...trade, price: -1 })).rejects.toThrow(
        'price must be a positive number',
      );
      await expect(create({ ...trade, fee: 1.5 })).rejects.toThrow(
        'whole number of cents',
      );
      await expect(create({ ...trade, date: 'soon' })).rejects.toThrow(
        'invalid date',
      );
      expect(await db.getTransactions(account)).toEqual([]);
    });

    it('leaves out trades of deleted accounts', async () => {
      const account = await createInvestmentAccount();
      const security = await createAapl();
      await app.handlers['trade-create']({
        account,
        security,
        date: '2026-01-02',
        type: 'buy',
        quantity: 1,
        price: 100,
      });

      await db.deleteAccount({ id: account });

      expect(await app.handlers['trades-get']({ security })).toEqual([]);
    });
  });
});

describe('vests', () => {
  async function vest(fields: Record<string, unknown> = {}) {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const id = await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-15',
      type: 'vest',
      quantity: 65,
      price: 150,
      withheld: 35,
      ...fields,
    });
    return { account, security, id };
  }

  it('bring in shares at the vest price without moving cash', async () => {
    const { account, id } = await vest();

    const [trade] = await app.handlers['trades-get']({ account });
    expect(trade).toMatchObject({
      id,
      type: 'vest',
      quantity: 65,
      withheld: 35,
    });
    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(({ investment_type }) => investment_type === 'trade'),
    ).toMatchObject({
      amount: 0,
      notes: 'Vest 65 AAPL @ 150, 35 withheld for tax',
    });

    const { holdings, cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(0);
    expect(holdings[0]).toMatchObject({
      quantity: 65,
      costBasis: 975000,
      unrealizedGain: 0,
    });
    expect(await getBalance(account)).toBe(975000);
  });

  it('leave out the withheld shares from the notes when there are none', async () => {
    const { account } = await vest({ withheld: 0 });
    const transactions = await db.getTransactions(account);
    expect(transactions.map(({ notes }) => notes)).toContain(
      'Vest 65 AAPL @ 150',
    );
  });

  it("can't have a fee, and only they withhold shares", async () => {
    await expect(vest({ fee: 500 })).rejects.toThrow('vest has no fee');
    await expect(vest({ type: 'buy' })).rejects.toThrow(
      'only a vest withholds shares',
    );
    await expect(vest({ withheld: -1 })).rejects.toThrow('zero or more');
  });

  it('drop the withheld shares when changed to a buy', async () => {
    const { account, id } = await vest();
    await app.handlers['trade-update']({ id, type: 'buy' });

    const [trade] = await app.handlers['trades-get']({ account });
    expect(trade).toMatchObject({ type: 'buy', withheld: 0 });
    const { cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-975000);
  });
});

// The clock in tests is fixed at 2017-01-01
describe('holdings-get', () => {
  it('values each holding and adds up the cash', async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const other = await app.handlers['security-create']({
      symbol: 'MSFT',
      exchange: 'US',
    });
    const create = app.handlers['trade-create'];
    await create({
      account,
      security,
      date: '2016-01-02',
      type: 'buy',
      quantity: 10,
      price: 100,
      fee: 500,
    });
    await create({
      account,
      security: other,
      date: '2016-01-02',
      type: 'buy',
      quantity: 1,
      price: 50,
    });
    await create({
      account,
      security: other,
      date: '2016-01-03',
      type: 'sell',
      quantity: 1,
      price: 60,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-02-01',
      close: 120,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-01-15',
      close: 110,
    });

    const { holdings, cash } = await app.handlers['holdings-get']({ account });

    expect(cash).toBe(-100500 - 5000 + 6000);
    expect(holdings).toEqual([
      expect.objectContaining({
        symbol: 'AAPL',
        quantity: 10,
        averageCost: 100.5,
        costBasis: 100500,
        price: 120,
        priceDate: '2016-02-01',
        marketValue: 120000,
        unrealizedGain: 19500,
        realizedGain: 0,
      }),
      expect.objectContaining({
        symbol: 'MSFT',
        quantity: 0,
        marketValue: 0,
        realizedGain: 1000,
      }),
    ]);
  });

  it('only uses trades and prices of the account and past days', async () => {
    const account = await createInvestmentAccount();
    const otherAccount = await accountsApp.handlers['account-create']({
      name: 'Other',
      currency: 'USD',
      investment: true,
    });
    const security = await createAapl();
    const trade = {
      security,
      date: '2016-01-02',
      type: 'buy' as const,
      quantity: 1,
      price: 100,
    };
    await app.handlers['trade-create']({ ...trade, account });
    await app.handlers['trade-create']({
      ...trade,
      account: otherAccount,
      quantity: 5,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2999-01-01',
      close: 999,
    });

    const { holdings } = await app.handlers['holdings-get']({ account });
    expect(holdings).toEqual([
      expect.objectContaining({ quantity: 1, price: 100 }),
    ]);
  });

  it('has nothing for an account without trades', async () => {
    const account = await createInvestmentAccount();
    expect(await app.handlers['holdings-get']({ account })).toEqual({
      holdings: [],
      cash: 0,
      suggestedSplits: [],
      suggestedDividends: [],
    });
  });
});

// The clock in tests is fixed at 2017-01-01
describe('market value', () => {
  async function marketValueTransactions(account: string) {
    const transactions = await db.getTransactions(account);
    return transactions
      .filter(transaction => transaction.investment_type === 'market-value')
      .map(({ date, amount }) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async function setUp() {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const id = await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-15',
      type: 'buy',
      quantity: 10,
      price: 100,
      fee: 500,
    });
    return { account, security, id };
  }

  it('adds the value of a buy, leaving only the fee off the balance', async () => {
    const { account } = await setUp();

    // On the day of the buy, so the balance doesn't dip until the month ends
    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 100000 },
    ]);
    expect(await getBalance(account)).toBe(-500);
  });

  it('records each month by what the value changed', async () => {
    const { account, security } = await setUp();
    const set = app.handlers['security-price-set'];
    await set({ security, date: '2016-11-10', close: 110 });
    await set({ security, date: '2016-12-20', close: 90 });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 100000 },
      { date: '2016-11-30', amount: 10000 },
      { date: '2016-12-31', amount: -20000 },
    ]);
    // Cash of -1,005 and 10 shares at 90
    expect(await getBalance(account)).toBe(-100500 + 90000);
  });

  it('keeps each security apart, with notes saying which it is', async () => {
    const { account, security } = await setUp();
    const msft = await app.handlers['security-create']({
      symbol: 'MSFT',
      exchange: 'US',
    });
    await app.handlers['trade-create']({
      account,
      security: msft,
      date: '2016-11-15',
      type: 'buy',
      quantity: 2.5,
      price: 60,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-11-10',
      close: 110.123456,
    });
    await app.handlers['trade-create']({
      account,
      security: msft,
      date: '2016-12-15',
      type: 'sell',
      quantity: 2.5,
      price: 62,
    });

    const transactions = await db.getTransactions(account);
    expect(
      transactions
        .filter(transaction => transaction.investment_type === 'market-value')
        .map(({ date, amount, notes }) => ({ date, amount, notes }))
        .sort((a, b) => a.notes.localeCompare(b.notes)),
    ).toEqual([
      {
        date: '2016-11-30',
        amount: 10123,
        notes: 'Market value 10 AAPL @ 110.1235',
      },
      // What the price did between the buy at 60 and the sale at 62
      { date: '2016-12-31', amount: 500, notes: 'Market value MSFT, sold' },
      {
        date: '2016-10-15',
        amount: 100000,
        notes: 'Shares in: 10 AAPL @ 100',
      },
      {
        date: '2016-11-15',
        amount: 15000,
        notes: 'Shares in: 2.5 MSFT @ 60',
      },
      {
        date: '2016-12-15',
        amount: -15500,
        notes: 'Shares out: 2.5 MSFT @ 62',
      },
    ]);
  });

  it('replaces a transaction for all securities at once', async () => {
    const { account, security } = await setUp();
    await db.insertTransaction({
      id: `market-value-${account}-2016-10`,
      account,
      amount: 100000,
      date: '2016-10-31',
      notes: 'Market value',
      cleared: true,
      investment_type: 'market-value',
    });

    await app.handlers['security-price-set']({
      security,
      date: '2016-10-31',
      close: 100,
    });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 100000 },
    ]);
  });

  it('matches the value and cash of the holdings', async () => {
    const { account, security } = await setUp();
    await app.handlers['security-price-set']({
      security,
      date: '2016-12-20',
      close: 120,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-12-21',
      type: 'sell',
      quantity: 4,
      price: 120,
    });

    const { holdings, cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-100500 + 48000);
    expect(await getBalance(account)).toBe(cash + holdings[0].marketValue);
  });

  it('follows price changes and removals', async () => {
    const { account, security } = await setUp();
    const id = await app.handlers['security-price-set']({
      security,
      date: '2016-11-10',
      close: 110,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-11-10',
      close: 120,
    });
    expect(await getBalance(account)).toBe(-100500 + 120000);

    await app.handlers['security-price-delete']({ id });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 100000 },
    ]);
  });

  it('follows backdated trades', async () => {
    const { account, id } = await setUp();
    await app.handlers['trade-update']({ id, date: '2016-09-15', quantity: 5 });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-09-15', amount: 50000 },
    ]);
  });

  it('removes the value with the last trade, and restores it', async () => {
    const { account, security, id } = await setUp();
    await app.handlers['trade-delete']({ id });

    expect(await marketValueTransactions(account)).toEqual([]);
    expect(await getBalance(account)).toBe(0);

    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-15',
      type: 'buy',
      quantity: 2,
      price: 100,
    });
    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 20000 },
    ]);
  });

  it('values every account holding the security', async () => {
    const { account, security } = await setUp();
    const other = await accountsApp.handlers['account-create']({
      name: 'Other',
      currency: 'USD',
      investment: true,
    });
    await app.handlers['trade-create']({
      account: other,
      security,
      date: '2016-10-15',
      type: 'buy',
      quantity: 1,
      price: 100,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-11-01',
      close: 200,
    });

    expect(await getBalance(account)).toBe(-100500 + 200000);
    expect(await getBalance(other)).toBe(-10000 + 20000);
  });

  it('leaves closed accounts alone', async () => {
    const { account, security } = await setUp();
    await db.update('accounts', { id: account, closed: 1 });
    await app.handlers['security-price-set']({
      security,
      date: '2016-11-01',
      close: 200,
    });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-15', amount: 100000 },
    ]);
  });

  it('converts to the main currency at the rate of the day', async () => {
    await db.run(
      'INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)',
      ['defaultCurrencyCode', 'CAD'],
    );
    await db.insert('exchange_rates', {
      id: 'USD-CAD-2016-01-01',
      date: 20160101,
      from_currency: 'USD',
      to_currency: 'CAD',
      rate: 1.5,
      source: 'manual',
      tombstone: 0,
    });
    const { account } = await setUp();

    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(t => t.investment_type === 'market-value'),
    ).toMatchObject({ amount: 100000, converted_amount: 150000 });
  });

  it('protects its transactions from ordinary edits', async () => {
    const { account } = await setUp();
    const transactions = await db.getTransactions(account);
    expect(transactions).toHaveLength(2);
    const before = await getBalance(account);

    await batchUpdateTransactions({
      updated: transactions.map(({ id }) => ({ id, amount: 1 })),
    });
    await batchUpdateTransactions({
      deleted: transactions.map(({ id }) => ({ id })),
    });

    expect(await db.getTransactions(account)).toHaveLength(2);
    expect(await getBalance(account)).toBe(before);
  });

  it('still applies ordinary edits in the same batch', async () => {
    const { account } = await setUp();
    const deposit = await db.insertTransaction({
      account,
      amount: 5000,
      date: '2016-10-01',
    });
    const [locked] = await db.getTransactions(account);

    await batchUpdateTransactions({
      updated: [
        { id: deposit, amount: 7000 },
        { id: locked.id, amount: 1 },
      ],
    });

    const after = await db.getTransactions(account);
    expect(after.find(t => t.id === deposit)?.amount).toBe(7000);
    expect(after.find(t => t.id === locked.id)?.amount).not.toBe(1);
  });

  it('is left out of income and spending but not of balances', async () => {
    const { account } = await setUp();
    const deposit = await db.insertTransaction({
      account,
      amount: 5000,
      date: '2016-10-01',
    });

    const activity = await aqlQuery(
      q('transactions')
        .filter({ account })
        .filter(NOT_INVESTMENT_ACTIVITY)
        .select('id'),
    );
    expect(activity.data).toEqual([{ id: deposit }]);

    const balance = await aqlQuery(
      q('transactions').filter({ account }).calculate({ $sum: '$amount' }),
    );
    expect(balance.data).toBe(5000 - 100500 + 100000);
  });

  it("doesn't count market value as cash", async () => {
    const { account } = await setUp();
    const { cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-100500);
  });
});

describe('dividends', () => {
  it('bring in cash for a security without changing its shares', async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-03',
      type: 'buy',
      quantity: 10,
      price: 100,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'dividend',
      amount: 1240,
    });

    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(({ notes }) => notes === 'Dividend AAPL'),
    ).toMatchObject({ amount: 1240, investment_type: 'trade' });
    const { holdings, cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-100000 + 1240);
    expect(holdings[0]).toMatchObject({
      quantity: 10,
      costBasis: 100000,
      // A dividend has no price, so the shares are still valued at the buy's
      price: 100,
      realizedGain: 0,
      dividends: 1240,
    });
  });

  it('only have an amount', async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const base = {
      account,
      security,
      date: '2016-11-10',
      type: 'dividend' as const,
    };
    await expect(
      app.handlers['trade-create']({ ...base, amount: 0 }),
    ).rejects.toThrow('dividend amount must be a positive');
    await expect(
      app.handlers['trade-create']({ ...base, amount: 100, quantity: 1 }),
    ).rejects.toThrow('dividend has only an amount');
  });

  it("can't be changed to another type", async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const id = await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'dividend',
      amount: 500,
    });
    await expect(
      app.handlers['trade-update']({ id, type: 'buy' }),
    ).rejects.toThrow("a dividend trade can't be changed to a buy");
    await app.handlers['trade-update']({ id, amount: 700 });
    const [trade] = await app.handlers['trades-get']({ account });
    expect(trade.amount).toBe(700);
  });
});

describe('reinvested dividends', () => {
  it('add shares at the dividend without moving cash', async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-03',
      type: 'buy',
      quantity: 10,
      price: 100,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'reinvested-dividend',
      quantity: 0.5,
      price: 110,
    });

    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(({ notes }) => notes?.startsWith('Reinvested')),
    ).toMatchObject({
      amount: 0,
      notes: 'Reinvested dividend 0.5 AAPL @ 110',
    });
    const { holdings, cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-100000);
    expect(holdings[0]).toMatchObject({
      quantity: 10.5,
      costBasis: 105500,
      dividends: 5500,
      marketValue: 115500,
    });
  });

  it('can change type with buys, but not to a dividend', async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    const id = await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'reinvested-dividend',
      quantity: 1,
      price: 110,
    });
    await app.handlers['trade-update']({ id, type: 'buy' });
    await expect(
      app.handlers['trade-update']({ id, type: 'dividend' }),
    ).rejects.toThrow("a buy trade can't be changed to a dividend");
  });
});

describe('returns of capital', () => {
  async function setUp() {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-10-03',
      type: 'buy',
      quantity: 10,
      price: 100,
    });
    return { account, security };
  }

  it('bring in cash and lower the cost of the shares', async () => {
    const { account, security } = await setUp();
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'return-of-capital',
      amount: 20000,
    });

    const transactions = await db.getTransactions(account);
    expect(
      transactions.find(({ notes }) => notes === 'Return of capital AAPL'),
    ).toMatchObject({ amount: 20000 });
    const { holdings, cash } = await app.handlers['holdings-get']({ account });
    expect(cash).toBe(-80000);
    expect(holdings[0]).toMatchObject({
      quantity: 10,
      costBasis: 80000,
      averageCost: 80,
      realizedGain: 0,
      dividends: 0,
    });
  });

  it('count what goes past zero cost as a realized gain', async () => {
    const { account, security } = await setUp();
    const id = await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'return-of-capital',
      amount: 120000,
    });
    const { holdings } = await app.handlers['holdings-get']({ account });
    expect(holdings[0]).toMatchObject({ costBasis: 0, realizedGain: 20000 });

    // Later buys start from zero again
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-20',
      type: 'buy',
      quantity: 10,
      price: 50,
    });
    const after = await app.handlers['holdings-get']({ account });
    expect(after.holdings[0]).toMatchObject({
      costBasis: 50000,
      averageCost: 25,
    });

    await app.handlers['trade-update']({ id, type: 'dividend' });
    const [trade] = (await app.handlers['trades-get']({ account })).filter(
      other => other.id === id,
    );
    expect(trade).toMatchObject({ type: 'dividend', amount: 120000 });
  });

  it('lower the cost that moved shares carry', async () => {
    const { account, security } = await setUp();
    const other = await accountsApp.handlers['account-create']({
      name: 'Other',
      currency: 'USD',
      investment: true,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-10',
      type: 'return-of-capital',
      amount: 10000,
    });
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-11-20',
      type: 'move-out',
      quantity: 10,
      price: 100,
      transfer_account: other,
    });
    const { holdings } = await app.handlers['holdings-get']({ account: other });
    expect(holdings[0].costBasis).toBe(90000);
  });
});

describe('moves', () => {
  async function setUp() {
    const from = await accountsApp.handlers['account-create']({
      name: 'Plan',
      currency: 'USD',
      investment: true,
    });
    const to = await accountsApp.handlers['account-create']({
      name: 'Brokerage',
      currency: 'USD',
      investment: true,
    });
    const security = await createAapl();
    // 20 shares cost 1,000 and 3,000, so 200 each on average
    await app.handlers['trade-create']({
      account: from,
      security,
      date: '2016-01-04',
      type: 'vest',
      quantity: 10,
      price: 100,
    });
    await app.handlers['trade-create']({
      account: from,
      security,
      date: '2016-02-01',
      type: 'buy',
      quantity: 10,
      price: 300,
    });
    const id = await app.handlers['trade-create']({
      account: from,
      security,
      date: '2016-06-01',
      type: 'move-out',
      quantity: 15,
      price: 400,
      transfer_account: to,
    });
    return { from, to, security, id };
  }

  it('take shares to another account with their cost', async () => {
    const { from, to, id } = await setUp();

    const [moveOut] = await app.handlers['trades-get']({ account: from });
    const [moveIn] = await app.handlers['trades-get']({ account: to });
    expect(moveOut).toMatchObject({
      id,
      type: 'move-out',
      transfer_id: moveIn.id,
      transfer_account: to,
    });
    expect(moveIn).toMatchObject({
      type: 'move-in',
      quantity: 15,
      price: 400,
      transfer_id: id,
      transfer_account: from,
    });

    const fromHolding = (await app.handlers['holdings-get']({ account: from }))
      .holdings[0];
    expect(fromHolding).toMatchObject({
      quantity: 5,
      costBasis: 100000,
      realizedGain: 0,
    });
    const toHoldings = await app.handlers['holdings-get']({ account: to });
    expect(toHoldings.cash).toBe(0);
    expect(toHoldings.holdings[0]).toMatchObject({
      quantity: 15,
      costBasis: 300000,
      averageCost: 200,
      marketValue: 600000,
    });

    // No cash moves, and each account's value follows its shares
    const notes = (await db.getTransactions(to)).map(t => [t.notes, t.amount]);
    expect(notes).toContainEqual(['Move 15 AAPL @ 400 from Plan', 0]);
    expect(await getBalance(to)).toBe(600000);
    expect(await getBalance(from)).toBe(-300000 + 200000);
  });

  it('follow changes to what the shares cost before', async () => {
    const { from, to, security } = await setUp();
    await app.handlers['trade-create']({
      account: from,
      security,
      date: '2016-03-01',
      type: 'buy',
      quantity: 20,
      price: 50,
    });
    // Now 40 shares cost 5,000, so 125 each
    const { holdings } = await app.handlers['holdings-get']({ account: to });
    expect(holdings[0].costBasis).toBe(187500);
  });

  it('keep their first cost when moved again', async () => {
    const { to, security } = await setUp();
    const third = await accountsApp.handlers['account-create']({
      name: 'Third',
      currency: 'USD',
      investment: true,
    });
    await app.handlers['trade-create']({
      account: to,
      security,
      date: '2016-07-01',
      type: 'move-out',
      quantity: 15,
      price: 500,
      transfer_account: third,
    });
    const { holdings } = await app.handlers['holdings-get']({ account: third });
    expect(holdings[0]).toMatchObject({ quantity: 15, costBasis: 300000 });
  });

  it('keep their first cost when moved again on the same day', async () => {
    const { to, security } = await setUp();
    const third = await accountsApp.handlers['account-create']({
      name: 'Third',
      currency: 'USD',
      investment: true,
    });
    await app.handlers['trade-create']({
      account: to,
      security,
      date: '2016-06-01',
      type: 'move-out',
      quantity: 15,
      price: 400,
      transfer_account: third,
    });
    const { holdings } = await app.handlers['holdings-get']({ account: third });
    expect(holdings[0]).toMatchObject({ quantity: 15, costBasis: 300000 });
  });

  it('keep their first cost however often they go back and forth', async () => {
    const { from, to, security } = await setUp();
    // 15 shares sit in the brokerage and 5 in the plan, all at 200 each
    for (let day = 10; day < 24; day++) {
      const isBack = day % 2 === 0;
      await app.handlers['trade-create']({
        account: isBack ? to : from,
        security,
        date: `2016-06-${day}`,
        type: 'move-out',
        quantity: 15,
        price: 1000,
        transfer_account: isBack ? from : to,
      });
    }
    const [fromHolding] = (
      await app.handlers['holdings-get']({ account: from })
    ).holdings;
    const [toHolding] = (await app.handlers['holdings-get']({ account: to }))
      .holdings;
    expect(fromHolding).toMatchObject({ quantity: 5, costBasis: 100000 });
    expect(toHolding).toMatchObject({ quantity: 15, costBasis: 300000 });
  });

  it('take what shares were worth when moved both ways on one day', async () => {
    const { from, to, security } = await setUp();
    // Each account counts its shares coming in before those going out, so
    // these two wait for each other and one of them is let through at 400
    await app.handlers['trade-create']({
      account: to,
      security,
      date: '2016-06-01',
      type: 'move-out',
      quantity: 5,
      price: 400,
      transfer_account: from,
    });
    const holdings = await Promise.all(
      [from, to].map(
        async account =>
          (await app.handlers['holdings-get']({ account })).holdings[0],
      ),
    );
    expect(holdings.map(holding => holding.quantity)).toEqual([10, 10]);
    expect(
      holdings.reduce((total, holding) => total + holding.costBasis, 0),
    ).toBeGreaterThan(0);
  });

  it('change and delete both halves together', async () => {
    const { from, to, id } = await setUp();
    const [moveIn] = await app.handlers['trades-get']({ account: to });

    await app.handlers['trade-update']({ id: moveIn.id, quantity: 5 });
    const [moveOut] = await app.handlers['trades-get']({ account: from });
    expect(moveOut).toMatchObject({ id, quantity: 5, type: 'move-out' });

    await app.handlers['trade-delete']({ id });
    expect(await app.handlers['trades-get']({ account: to })).toEqual([]);
    expect(
      (await db.getTransactions(to)).filter(t => t.investment_type === 'trade'),
    ).toEqual([]);
  });

  it("can't take more shares than are held, or leave later sells short", async () => {
    const { to, security, id } = await setUp();
    await expect(
      app.handlers['trade-update']({ id, quantity: 25 }),
    ).rejects.toThrow('trade sells more shares than are held');

    await app.handlers['trade-create']({
      account: to,
      security,
      date: '2016-08-01',
      type: 'sell',
      quantity: 15,
      price: 500,
    });
    await expect(
      app.handlers['trade-update']({ id, quantity: 10 }),
    ).rejects.toThrow('trade sells more shares than are held');
    await expect(app.handlers['trade-delete']({ id })).rejects.toThrow(
      'later sells',
    );
  });

  it('only go to another open account in the same currency', async () => {
    const { from, security } = await setUp();
    const cad = await createInvestmentAccount('CAD');
    const base = {
      account: from,
      security,
      date: '2016-06-02',
      type: 'move-out' as const,
      quantity: 1,
      price: 400,
    };
    await expect(app.handlers['trade-create'](base)).rejects.toThrow(
      'needs the account the shares go to',
    );
    await expect(
      app.handlers['trade-create']({ ...base, transfer_account: from }),
    ).rejects.toThrow('only move to another account');
    await expect(
      app.handlers['trade-create']({ ...base, transfer_account: cad }),
    ).rejects.toThrow('only move to another USD account');
    await expect(
      app.handlers['trade-create']({ ...base, type: 'move-in' }),
    ).rejects.toThrow('made from the account the shares leave');
  });

  it('let an account be closed once its shares have moved', async () => {
    const { from, to, security } = await setUp();
    await app.handlers['trade-create']({
      account: from,
      security,
      date: '2016-06-03',
      type: 'move-out',
      quantity: 5,
      price: 400,
      transfer_account: to,
    });
    const { holdings } = await app.handlers['holdings-get']({ account: from });
    expect(holdings[0].quantity).toBe(0);
  });
});

describe('investment-performance-get', () => {
  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
  });

  it("gives the account's returns by month", async () => {
    const account = await createInvestmentAccount();
    const security = await createAapl();
    await app.handlers['trade-create']({
      account,
      security,
      date: '2016-01-04',
      type: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-01-29',
      close: 110,
    });
    await app.handlers['security-price-set']({
      security,
      date: '2016-02-29',
      close: 95,
    });

    const performance = await app.handlers['investment-performance-get']({
      account,
    });

    expect(performance.securities).toEqual([{ id: security, symbol: 'AAPL' }]);
    const [january, february] = performance.months;
    expect(january).toMatchObject({
      month: '2016-01',
      date: '2016-01-31',
      total: { value: 110000, gain: 10000, growth: 1.1 },
    });
    expect(january.securities[security].growth).toBe(1.1);
    expect(february.total.growth).toBeCloseTo(0.95);
    expect(february.total.gain).toBe(-15000);
  });
});

describe('getMarketValueChanges', () => {
  const securities = [
    { id: 'US-A', symbol: 'A', name: null, currency: 'USD' },
    { id: 'US-B', symbol: 'B', name: null, currency: 'USD' },
  ];
  const buy = (
    security: string,
    date: string,
    quantity: number,
    price: number,
  ) => ({
    id: `buy-${security}-${date}`,
    security,
    date,
    type: 'buy' as const,
    quantity,
    price,
    fee: 0,
  });

  it('has nothing without trades or before the first one', () => {
    expect(
      getMarketValueChanges({
        securities,
        trades: [],
        prices: [],
        today: '2026-01-15',
      }),
    ).toEqual([]);
    expect(
      getMarketValueChanges({
        securities,
        trades: [buy('US-A', '2026-02-01', 1, 100)],
        prices: [],
        today: '2026-01-15',
      }),
    ).toEqual([]);
  });

  it('values shares on the day of their trade, so the balance has no dip', () => {
    expect(
      getMarketValueChanges({
        securities,
        trades: [buy('US-A', '2025-11-05', 1, 100)],
        prices: [{ security: 'US-A', date: '2025-11-20', close: 104 }],
        today: '2026-01-15',
      }),
    ).toEqual([
      {
        security: 'US-A',
        month: '2025-11',
        date: '2025-11-05',
        amount: 10000,
        quantity: 1,
        price: 100,
        trade: { id: 'buy-US-A-2025-11-05', type: 'buy' },
      },
      // Only what the price did since
      {
        security: 'US-A',
        month: '2025-11',
        date: '2025-11-30',
        amount: 400,
        quantity: 1,
        price: 104,
      },
    ]);
  });

  it('dates the current month today and skips months without a change', () => {
    expect(
      getMarketValueChanges({
        securities,
        trades: [buy('US-A', '2025-11-05', 1, 100)],
        prices: [{ security: 'US-A', date: '2026-01-10', close: 150 }],
        today: '2026-01-15',
      }),
    ).toEqual([
      expect.objectContaining({ date: '2025-11-05', amount: 10000 }),
      {
        security: 'US-A',
        month: '2026-01',
        date: '2026-01-15',
        amount: 5000,
        quantity: 1,
        price: 150,
      },
    ]);
  });

  it('keeps securities apart, using the price known at each month end', () => {
    expect(
      getMarketValueChanges({
        securities,
        trades: [
          buy('US-A', '2025-11-05', 1, 100),
          buy('US-B', '2025-12-05', 2, 50),
        ],
        prices: [
          { security: 'US-A', date: '2025-11-20', close: 110 },
          { security: 'US-A', date: '2025-12-20', close: 120 },
          { security: 'US-A', date: '2026-02-01', close: 999 },
        ],
        today: '2026-01-15',
      }),
    ).toEqual([
      expect.objectContaining({
        security: 'US-A',
        date: '2025-11-05',
        amount: 10000,
      }),
      expect.objectContaining({
        security: 'US-A',
        month: '2025-11',
        date: '2025-11-30',
        amount: 1000,
      }),
      expect.objectContaining({
        security: 'US-A',
        month: '2025-12',
        amount: 1000,
        price: 120,
      }),
      expect.objectContaining({
        security: 'US-B',
        date: '2025-12-05',
        amount: 10000,
        quantity: 2,
      }),
    ]);
  });

  it('takes out the shares of a sale on its day, and adds up to nothing', () => {
    const changes = getMarketValueChanges({
      securities,
      trades: [
        buy('US-A', '2025-11-05', 3, 100),
        {
          id: 'sell',
          security: 'US-A',
          date: '2025-12-05',
          type: 'sell' as const,
          quantity: 3,
          price: 120,
          fee: 0,
        },
      ],
      prices: [],
      today: '2026-01-15',
    });
    expect(changes).toEqual([
      expect.objectContaining({ date: '2025-11-05', amount: 30000 }),
      expect.objectContaining({ date: '2025-12-05', amount: -36000 }),
      // The gain since the buy, which the sale turned into cash
      expect.objectContaining({ date: '2025-12-31', amount: 6000 }),
    ]);
    expect(changes.reduce((sum, change) => sum + change.amount, 0)).toBe(0);
  });

  it('has no shares to value for cash a security paid out', () => {
    const changes = getMarketValueChanges({
      securities,
      trades: [
        buy('US-A', '2025-11-05', 1, 100),
        {
          id: 'dividend',
          security: 'US-A',
          date: '2025-11-20',
          type: 'dividend' as const,
          quantity: 0,
          price: 0,
          fee: 0,
        },
      ],
      prices: [],
      today: '2026-01-15',
    });
    expect(changes).toEqual([
      expect.objectContaining({ date: '2025-11-05', amount: 10000 }),
    ]);
  });
});

describe('calculateHolding', () => {
  const security = {
    id: 'US-AAPL',
    symbol: 'AAPL',
    name: null,
    currency: 'USD',
  };

  it('keeps the average cost through a partial sell', () => {
    const holding = calculateHolding(security, [
      { date: '2026-01-01', type: 'buy', quantity: 10, price: 100, fee: 0 },
      { date: '2026-01-02', type: 'buy', quantity: 10, price: 200, fee: 0 },
      { date: '2026-01-03', type: 'sell', quantity: 5, price: 300, fee: 1000 },
    ]);

    expect(holding.quantity).toBe(15);
    expect(holding.averageCost).toBe(150);
    expect(holding.costBasis).toBe(225000);
    // 5 x 300 less the fee and 5 x the average of 150
    expect(holding.realizedGain).toBe(74000);
  });

  it('applies trades in date order, whatever order they come in', () => {
    const holding = calculateHolding(security, [
      { date: '2026-01-02', type: 'sell', quantity: 5, price: 200, fee: 0 },
      { date: '2026-01-01', type: 'buy', quantity: 10, price: 100, fee: 0 },
    ]);

    expect(holding.quantity).toBe(5);
    expect(holding.realizedGain).toBe(50000);
  });

  it('counts a position as closed despite share rounding', () => {
    const holding = calculateHolding(security, [
      { date: '2026-01-01', type: 'buy', quantity: 0.1, price: 100, fee: 0 },
      { date: '2026-01-01', type: 'buy', quantity: 0.2, price: 100, fee: 0 },
      { date: '2026-01-02', type: 'sell', quantity: 0.3, price: 200, fee: 0 },
    ]);

    expect(holding).toMatchObject({
      quantity: 0,
      costBasis: 0,
      averageCost: 0,
      marketValue: 0,
      unrealizedGain: 0,
      unrealizedGainRatio: 0,
      realizedGain: 3000,
    });
  });

  it('uses the latest trade price over an older close', () => {
    const trades = [
      {
        date: '2026-01-10',
        type: 'buy' as const,
        quantity: 2,
        price: 100,
        fee: 0,
      },
    ];

    expect(
      calculateHolding(security, trades, { date: '2026-01-01', close: 90 }),
    ).toMatchObject({
      price: 100,
      priceDate: '2026-01-10',
      marketValue: 20000,
    });
    expect(
      calculateHolding(security, trades, { date: '2026-01-10', close: 110 }),
    ).toMatchObject({
      price: 110,
      priceDate: '2026-01-10',
      marketValue: 22000,
      unrealizedGain: 2000,
      unrealizedGainRatio: 0.1,
    });
  });
});

describe('getTradeCashAmount', () => {
  it('rounds to cents', () => {
    expect(
      getTradeCashAmount({
        type: 'buy',
        quantity: 0.123456,
        price: 500.55,
        fee: 0,
      }),
    ).toBe(-6180);
  });
});

describe('getTradeCashAmount of a vest', () => {
  it('moves no cash', () => {
    expect(
      getTradeCashAmount({ type: 'vest', quantity: 10, price: 100, fee: 0 }),
    ).toBe(0);
  });
});

describe('sellsMoreThanHeld', () => {
  it('counts buys before sells on the same day', () => {
    expect(
      sellsMoreThanHeld([
        { date: '2026-01-01', type: 'sell', quantity: 1 },
        { date: '2026-01-01', type: 'buy', quantity: 1 },
      ]),
    ).toBe(false);
  });
});

describe('getPerformanceHistory', () => {
  const securities = [{ id: 'US-A' }, { id: 'US-B' }];
  const trade = (
    security: string,
    date: string,
    type: TradeType,
    quantity: number,
    price: number,
    fee = 0,
  ) => ({ security, date, type, quantity, price, fee });
  const growth = (months: PerformanceMonth[]) =>
    months.map(({ total }) => total.growth);

  it('has nothing without trades', () => {
    expect(
      getPerformanceHistory({
        securities,
        trades: [],
        prices: [],
        today: '2026-01-15',
      }),
    ).toEqual([]);
  });

  it('gives the value, gain and growth at each month end', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [trade('US-A', '2025-11-05', 'buy', 10, 100, 1000)],
      prices: [
        { security: 'US-A', date: '2025-12-31', close: 121 },
        { security: 'US-A', date: '2026-01-10', close: 90 },
      ],
      today: '2026-01-15',
    });
    expect(months.map(({ month, date }) => [month, date])).toEqual([
      ['2025-11', '2025-11-30'],
      ['2025-12', '2025-12-31'],
      ['2026-01', '2026-01-15'],
    ]);
    // Bought for 1,010 with the fee, which is lost straight away
    expect(months.map(({ total }) => [total.value, total.gain])).toEqual([
      [100000, -1000],
      [121000, 21000],
      [90000, -31000],
    ]);
    [100000 / 101000, 121000 / 101000, 90000 / 101000].forEach(
      (expected, index) => expect(growth(months)[index]).toBeCloseTo(expected),
    );
    expect(months[1].securities['US-A']).toEqual(months[1].total);
    expect(months[1].securities['US-B']).toBeUndefined();
  });

  it("doesn't count money put in or taken out as a return", () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        // Up 10% by the next buy, which puts ten times as much in
        trade('US-A', '2026-02-10', 'buy', 100, 110),
        // Then down 10%, and half is sold
        trade('US-A', '2026-03-10', 'sell', 55, 99),
      ],
      prices: [],
      today: '2026-04-15',
    });
    // Up 10% then down 10%, however much was in at the time
    expect(growth(months)[3]).toBeCloseTo(0.99);
    // In money, the bigger second buy loses more than the first gained
    expect(months.map(({ total }) => total.gain)).toEqual([
      0, 10000, -121000, 0,
    ]);
  });

  it('keeps the growth while nothing is held', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        trade('US-A', '2026-01-20', 'sell', 10, 150),
        trade('US-A', '2026-03-05', 'buy', 10, 200),
      ],
      prices: [{ security: 'US-A', date: '2026-03-31', close: 220 }],
      today: '2026-03-31',
    });
    expect(growth(months)).toEqual([1.5, 1.5, 1.5 * 1.1]);
    expect(months[1].total.value).toBe(0);
  });

  it('counts fees and trades away from the close', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100, 500),
        trade('US-A', '2026-01-20', 'sell', 10, 110, 500),
      ],
      // Bought below the day's close, and sold above it
      prices: [
        { security: 'US-A', date: '2026-01-05', close: 105 },
        { security: 'US-A', date: '2026-01-20', close: 108 },
      ],
      today: '2026-01-31',
    });
    // 1,005 in and 1,095 out
    expect(month.total.gain).toBe(9000);
    expect(month.total.growth).toBeCloseTo((110000 - 500) / 100500);
  });

  it('counts a trade against the close of its own day', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [trade('US-A', '2026-01-31', 'buy', 10, 100, 500)],
      prices: [{ security: 'US-A', date: '2026-01-31', close: 120 }],
      today: '2026-02-01',
    });
    expect(month.total.growth).toBeCloseTo(120000 / 100500);
    expect(month.total.gain).toBe(19500);
  });

  it('counts price changes between trades on the same day', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 100, 150),
        // Some sold later that day at a lower price, like a sell to cover tax
        trade('US-A', '2026-01-05', 'sell', 37, 148),
        trade('US-B', '2026-01-02', 'buy', 10, 100),
      ],
      prices: [
        { security: 'US-A', date: '2026-01-05', close: 149 },
        { security: 'US-B', date: '2026-01-31', close: 100 },
      ],
      today: '2026-01-31',
    });
    // A: down from 150 to 148 before the sell, then up to the close of 149
    expect(month.securities['US-A'].growth).toBeCloseTo(
      (148 / 150) * (149 / 148),
    );
    // In money: 63 left worth 9,387 plus 5,476 from the sell, less 15,000
    expect(month.securities['US-A'].gain).toBe(-13700);
    // B's 1,000 didn't move, so it holds back the total's loss
    expect(month.total.growth).toBeCloseTo(
      ((1000 + 14800) / (1000 + 15000)) * ((1000 + 9387) / (1000 + 9324)),
    );
  });

  it('counts a vest as money put in at its price', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        {
          ...trade('US-A', '2026-01-05', 'buy', 10, 100),
          type: 'vest' as const,
        },
      ],
      prices: [{ security: 'US-A', date: '2026-01-20', close: 110 }],
      today: '2026-01-31',
    });
    expect(month.total).toEqual({ value: 110000, gain: 10000, growth: 1.1 });
  });

  it('counts dividends as a gain', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        { ...trade('US-A', '2026-01-20', 'dividend', 0, 0), amount: 5000 },
      ],
      prices: [],
      today: '2026-01-31',
    });
    // The price didn't move, and 50 was paid out on 1,000
    expect(month.total.growth).toBeCloseTo(1.05);
    expect(month.total.gain).toBe(5000);
    expect(month.total.value).toBe(100000);
  });

  it('counts reinvested dividends and returns of capital as gains', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        // 50 paid out in a share bought at 100, then 50 paid back in cash
        trade('US-A', '2026-01-10', 'reinvested-dividend', 0.5, 100),
        {
          ...trade('US-A', '2026-01-20', 'return-of-capital', 0, 0),
          amount: 5000,
        },
      ],
      prices: [],
      today: '2026-01-31',
    });
    expect(month.total.growth).toBeCloseTo(1.05 * (1 + 5000 / 105000));
    expect(month.total.gain).toBe(10000);
    expect(month.total.value).toBe(105000);
  });

  it('counts dividends paid after everything is sold', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        // Sold for 1,100, then 50 and 60 paid out on those shares
        trade('US-A', '2026-01-20', 'sell', 10, 110),
        { ...trade('US-A', '2026-02-10', 'dividend', 0, 0), amount: 5000 },
        { ...trade('US-A', '2026-02-20', 'dividend', 0, 0), amount: 6000 },
      ],
      prices: [],
      today: '2026-02-28',
    });
    // As if the 110 had come with the sale: 1,210 back on 1,000
    expect(growth(months)[0]).toBeCloseTo(1.1);
    expect(growth(months)[1]).toBeCloseTo(1.21);
    expect(months[1].securities['US-A'].growth).toBeCloseTo(1.21);
    expect(months[1].total.gain).toBe(11000);
  });

  it('counts a reinvested dividend paid after everything is sold', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        trade('US-A', '2026-01-20', 'sell', 10, 100),
        // 50 paid out in half a share, which then goes up 10%
        trade('US-A', '2026-02-10', 'reinvested-dividend', 0.5, 100),
      ],
      prices: [{ security: 'US-A', date: '2026-02-27', close: 110 }],
      today: '2026-02-28',
    });
    expect(growth(months)[1]).toBeCloseTo(1.05 * 1.1);
  });

  it('starts again from what was sold when sold out twice', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        trade('US-A', '2026-01-10', 'sell', 10, 100),
        trade('US-A', '2026-01-15', 'buy', 20, 100),
        trade('US-A', '2026-01-20', 'sell', 20, 100),
        // 100 paid out on the 2,000 sold last
        { ...trade('US-A', '2026-01-25', 'dividend', 0, 0), amount: 10000 },
      ],
      prices: [],
      today: '2026-01-31',
    });
    expect(growth(months)[0]).toBeCloseTo(1.05);
  });

  it('counts moved shares as money put in or taken out', () => {
    const months = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'move-in', 10, 100),
        trade('US-A', '2026-02-10', 'move-out', 5, 120),
      ],
      prices: [{ security: 'US-A', date: '2026-02-27', close: 130 }],
      today: '2026-02-28',
    });
    expect(growth(months)[1]).toBeCloseTo(1.3);
    // Up 200 before half moved out at 120, then up 50 on what was left
    expect(months.map(({ total }) => total.gain)).toEqual([0, 25000]);
  });

  it('weights the total by what each security held', () => {
    const [month] = getPerformanceHistory({
      securities,
      trades: [
        trade('US-A', '2026-01-05', 'buy', 10, 100),
        trade('US-B', '2026-01-05', 'buy', 30, 100),
      ],
      prices: [
        { security: 'US-A', date: '2026-01-10', close: 200 },
        { security: 'US-B', date: '2026-01-10', close: 100 },
      ],
      today: '2026-01-15',
    });
    expect(month.securities['US-A'].growth).toBe(2);
    expect(month.securities['US-B'].growth).toBe(1);
    expect(month.total).toEqual({ value: 500000, gain: 100000, growth: 1.25 });
  });

  it('values shares at their split-adjusted price', () => {
    const [, february] = getPerformanceHistory({
      securities,
      trades: [trade('US-A', '2026-01-05', 'buy', 10, 100)],
      prices: [{ security: 'US-A', date: '2026-02-20', close: 30 }],
      splits: [{ security: 'US-A', date: '2026-02-10', ratio: 4 }],
      today: '2026-02-25',
    });
    expect(february.total.growth).toBeCloseTo(1.2);
    expect(february.total.value).toBe(120000);
  });
});
