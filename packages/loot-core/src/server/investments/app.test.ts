import { app as accountsApp } from '#server/accounts/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app } from '#server/investments/app';
import { batchUpdateTransactions } from '#server/transactions';
import {
  calculateHolding,
  getMarketValueChanges,
  getTradeCashAmount,
  NOT_INVESTMENT_ACTIVITY,
  sellsMoreThanHeld,
} from '#shared/investments';
import { q } from '#shared/query';

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

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-31', amount: 100000 },
    ]);
    expect(await getBalance(account)).toBe(-500);
  });

  it('records each month by what the value changed', async () => {
    const { account, security } = await setUp();
    const set = app.handlers['security-price-set'];
    await set({ security, date: '2016-11-10', close: 110 });
    await set({ security, date: '2016-12-20', close: 90 });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-10-31', amount: 100000 },
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
        date: '2016-10-31',
        amount: 100000,
        notes: 'Market value 10 AAPL @ 100',
      },
      {
        date: '2016-11-30',
        amount: 10123,
        notes: 'Market value 10 AAPL @ 110.1235',
      },
      {
        date: '2016-11-30',
        amount: 15000,
        notes: 'Market value 2.5 MSFT @ 60',
      },
      { date: '2016-12-31', amount: -15000, notes: 'Market value MSFT, sold' },
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
      { date: '2016-10-31', amount: 100000 },
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
      { date: '2016-10-31', amount: 100000 },
    ]);
  });

  it('follows backdated trades', async () => {
    const { account, id } = await setUp();
    await app.handlers['trade-update']({ id, date: '2016-09-15', quantity: 5 });

    expect(await marketValueTransactions(account)).toEqual([
      { date: '2016-09-30', amount: 50000 },
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
      { date: '2016-10-31', amount: 20000 },
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
      { date: '2016-10-31', amount: 100000 },
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

  it('dates the current month today and skips months without a change', () => {
    expect(
      getMarketValueChanges({
        securities,
        trades: [buy('US-A', '2025-11-05', 1, 100)],
        prices: [{ security: 'US-A', date: '2026-01-10', close: 150 }],
        today: '2026-01-15',
      }),
    ).toEqual([
      {
        security: 'US-A',
        month: '2025-11',
        date: '2025-11-30',
        amount: 10000,
        quantity: 1,
        price: 100,
      },
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
        month: '2025-11',
        amount: 11000,
      }),
      expect.objectContaining({
        security: 'US-A',
        month: '2025-12',
        amount: 1000,
        price: 120,
      }),
      expect.objectContaining({
        security: 'US-B',
        month: '2025-12',
        amount: 10000,
        quantity: 2,
      }),
    ]);
  });

  it('adds up to the current value through a sale', () => {
    const changes = getMarketValueChanges({
      securities,
      trades: [
        buy('US-A', '2025-11-05', 3, 100),
        {
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
    expect(changes.reduce((sum, change) => sum + change.amount, 0)).toBe(0);
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
