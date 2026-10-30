import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as exchangeRatesApp } from '#server/exchange-rates/app';
import { handlers } from '#server/main';
import { handlers as mockServerHandlers } from '#server/tests/mockSyncServer';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';

import { addTransactions, reconcileTransactions } from './sync';

// The mock server's handler map is untyped
const serverHandlers = mockServerHandlers as Record<
  string,
  (data: { base: string; start: string; end?: string }) => unknown
>;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

async function setMainCurrency(code: string) {
  await db.run('INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)', [
    'defaultCurrencyCode',
    code,
  ]);
}

async function setRate(date: string, rate: number) {
  await exchangeRatesApp.handlers['exchange-rate-set']({
    date,
    from_currency: 'USD',
    to_currency: 'EUR',
    rate,
  });
}

function getRows(account: string) {
  return db.all<
    Pick<db.DbTransaction, 'id' | 'amount' | 'converted_amount' | 'isChild'>
  >(
    `SELECT id, amount, converted_amount, isChild FROM transactions
     WHERE acct = ? AND tombstone = 0 ORDER BY date, amount`,
    [account],
  );
}

describe('importing into an account in another currency', () => {
  let usAccount: string;
  let mainAccount: string;

  beforeEach(async () => {
    await setMainCurrency('EUR');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    mainAccount = await handlers['account-create']({ name: 'Main' });
    await setRate('2026-01-01', 0.9);
    await setRate('2026-02-01', 0.8);
  });

  it('converts imported transactions at the rate of their date', async () => {
    await reconcileTransactions(usAccount, [
      { date: '2026-01-15', payee_name: 'january', amount: -10000 },
      { date: '2026-02-15', payee_name: 'february', amount: -5000 },
    ]);

    const rows = await getRows(usAccount);
    expect(rows.map(row => row.converted_amount)).toEqual([-9000, -4000]);
  });

  it('leaves transactions in the main currency alone', async () => {
    await reconcileTransactions(mainAccount, [
      { date: '2026-01-15', payee_name: 'january', amount: -10000 },
    ]);

    const rows = await getRows(mainAccount);
    expect(rows.map(row => row.converted_amount)).toEqual([null]);
  });

  it('converts transactions added without running transfers', async () => {
    await addTransactions(
      usAccount,
      [{ date: '2026-01-15', payee_name: 'january', amount: -10000 }],
      { runTransfers: false },
    );

    const rows = await getRows(usAccount);
    expect(rows.map(row => row.converted_amount)).toEqual([-9000]);
  });

  it('converts again when the bank changes the date of a transaction', async () => {
    const transaction = {
      payee_name: 'pending',
      amount: -10000,
      imported_id: 'bank-1',
    };
    await reconcileTransactions(usAccount, [
      { ...transaction, date: '2026-01-31' },
    ]);

    await reconcileTransactions(
      usAccount,
      [{ ...transaction, date: '2026-02-02' }],
      { updateDates: true },
    );

    const rows = await getRows(usAccount);
    expect(rows).toHaveLength(1);
    expect(rows[0].converted_amount).toBe(-8000);
  });

  it('converts the parts of a split created by a rule', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        {
          op: 'is',
          field: 'imported_payee',
          value: 'Shop',
          type: 'string',
        },
      ],
      actions: [
        {
          op: 'set-split-amount',
          value: 2500,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set-split-amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
      ],
    });
    await loadRules();

    await reconcileTransactions(usAccount, [
      { date: '2026-01-15', payee_name: 'shop', amount: -10000 },
    ]);

    const rows = await getRows(usAccount);
    const children = rows.filter(row => row.isChild === 1);
    expect(children).toHaveLength(2);
    expect(children.every(row => row.converted_amount != null)).toBe(true);
    expect(
      children.reduce((sum, row) => sum + (row.converted_amount ?? 0), 0),
    ).toBe(-9000);
  });

  it('turns an imported transfer into both sides with their own currency', async () => {
    const transferPayee = await db.first<Pick<db.DbPayee, 'id'>>(
      'SELECT id FROM payees WHERE transfer_acct = ?',
      [mainAccount],
    );
    const payee = transferPayee?.id;

    await reconcileTransactions(usAccount, [
      { date: '2026-01-15', payee, amount: -10000 },
    ]);

    const [sent] = await getRows(usAccount);
    const [received] = await getRows(mainAccount);
    expect(received.amount).toBe(9000);
    // The main currency side decides what the transfer was worth
    expect(sent.converted_amount).toBe(-9000);
    expect(received.converted_amount).toBeNull();
  });
});

describe('fetching rates for imported history', () => {
  let usAccount: string;

  beforeEach(async () => {
    await setMainCurrency('EUR');
    vi.mocked(asyncStorage.getItem).mockResolvedValue('token');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
  });

  afterEach(() => {
    delete serverHandlers['/exchange-rates'];
    vi.mocked(asyncStorage.getItem).mockReset();
  });

  it('fetches rates for transactions older than any rate known', async () => {
    const requests: Array<{ start: string; end?: string }> = [];
    serverHandlers['/exchange-rates'] = data => {
      requests.push({ start: data.start, end: data.end });
      return {
        base: data.base,
        rates:
          data.start < '2016-12-01'
            ? { '2016-06-01': { EUR: 0.7 } }
            : { '2016-12-20': { EUR: 0.9 } },
      };
    };

    // Rates so far only go back to the first transaction
    await reconcileTransactions(usAccount, [
      { date: '2016-12-20', payee_name: 'recent', amount: -1000 },
    ]);
    await exchangeRatesApp.handlers['exchange-rates-update']();
    expect(requests).toEqual([{ start: '2016-12-20', end: '2017-01-01' }]);

    // Then older history is imported, which falls back on the earliest rate
    await reconcileTransactions(usAccount, [
      { date: '2016-06-01', payee_name: 'old', amount: -10000 },
    ]);
    const [old] = await getRows(usAccount);
    expect(old.converted_amount).toBe(-9000);

    requests.length = 0;
    await exchangeRatesApp.handlers['exchange-rates-update']();

    expect(requests[0].start).toBe('2016-06-01');
    const [updated] = await getRows(usAccount);
    expect(updated.converted_amount).toBe(-7000);
  });
});

describe('closing an account in another currency', () => {
  it('moves the balance to the other account at the exchange rate', async () => {
    await setMainCurrency('EUR');
    await setRate('2016-01-01', 0.5);
    const usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    const mainAccount = await handlers['account-create']({ name: 'Main' });
    await reconcileTransactions(usAccount, [
      { date: '2016-06-01', payee_name: 'salary', amount: 10000 },
    ]);

    await handlers['account-close']({
      id: usAccount,
      transferAccountId: mainAccount,
    });

    const [received] = await getRows(mainAccount);
    expect(received.amount).toBe(5000);
    const rows = await getRows(usAccount);
    expect(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)).toBe(0);
    expect(
      rows.reduce((sum, row) => sum + (row.converted_amount ?? 0), 0),
    ).toBe(0);
  });
});
