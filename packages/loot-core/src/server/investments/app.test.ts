import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app } from '#server/investments/app';
import { getTradeCashAmount, sellsMoreThanHeld } from '#shared/investments';

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
