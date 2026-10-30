import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/main';
import { q } from '#shared/query';

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
  await handlers['exchange-rate-set']({
    date,
    from_currency: 'USD',
    to_currency: 'EUR',
    rate,
  });
}

async function getConvertedAmount(id: string) {
  const row = await db.first<Pick<db.DbTransaction, 'converted_amount'>>(
    'SELECT converted_amount FROM transactions WHERE id = ?',
    [id],
  );
  return row?.converted_amount;
}

async function addTransaction(account: string, date: string, amount: number) {
  return db.insertTransaction({ account, date, amount });
}

describe('converted amounts', () => {
  let usAccount: string;
  let mainAccount: string;

  beforeEach(async () => {
    await setMainCurrency('EUR');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    mainAccount = await handlers['account-create']({
      name: 'Main',
    });
  });

  it('converts transactions in foreign accounts at the rate of their day', async () => {
    await setRate('2026-01-01', 0.9);
    await setRate('2026-01-10', 0.95);

    const early = await addTransaction(usAccount, '2026-01-05', -10000);
    const late = await addTransaction(usAccount, '2026-01-12', -10000);

    expect(await getConvertedAmount(early)).toBe(-9000);
    expect(await getConvertedAmount(late)).toBe(-9500);
  });

  it('leaves transactions in main currency accounts unconverted', async () => {
    await setRate('2026-01-01', 0.9);

    const id = await addTransaction(mainAccount, '2026-01-05', -10000);

    expect(await getConvertedAmount(id)).toBeNull();
  });

  it('leaves the converted amount empty when no rate is known', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    expect(await getConvertedAmount(id)).toBeNull();
  });

  it('ignores a converted amount copied with a transaction', async () => {
    await setRate('2026-01-01', 0.9);

    const id = await db.insertTransaction({
      account: usAccount,
      date: '2026-01-05',
      amount: -10000,
      converted_amount: -9300,
    });
    expect(await getConvertedAmount(id)).toBe(-9000);

    await db.updateTransaction({ id, converted_amount: -9300 });
    expect(await getConvertedAmount(id)).toBe(-9000);
  });

  it('updates the converted amount when the amount, date or account change', async () => {
    await setRate('2026-01-01', 0.9);
    await setRate('2026-01-10', 0.95);
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    await db.updateTransaction({ id, amount: -20000 });
    expect(await getConvertedAmount(id)).toBe(-18000);

    await db.updateTransaction({ id, date: '2026-01-12' });
    expect(await getConvertedAmount(id)).toBe(-19000);

    await db.updateTransaction({ id, account: mainAccount });
    expect(await getConvertedAmount(id)).toBeNull();
  });

  it('does not touch the converted amount for other changes', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);
    await db.update('transactions', { id, converted_amount: -9300 });

    await db.updateTransaction({ id, notes: 'Lunch' });

    expect(await getConvertedAmount(id)).toBe(-9300);
  });

  it('converts transactions added through the transaction handlers', async () => {
    await setRate('2026-01-01', 0.9);

    await handlers['transactions-batch-update']({
      added: [
        {
          id: 'added',
          account: usAccount,
          date: '2026-01-05',
          amount: -10000,
        },
      ],
    });

    expect(await getConvertedAmount('added')).toBe(-9000);
  });

  it('updates converted amounts on and after the day of a new rate', async () => {
    await setRate('2026-01-01', 0.9);
    const before = await addTransaction(usAccount, '2026-01-05', -10000);
    const after = await addTransaction(usAccount, '2026-01-12', -10000);

    await setRate('2026-01-10', 0.95);

    expect(await getConvertedAmount(before)).toBe(-9000);
    expect(await getConvertedAmount(after)).toBe(-9500);
  });

  it('converts earlier transactions with a new earliest rate', async () => {
    await setRate('2026-01-10', 0.95);
    const id = await addTransaction(usAccount, '2026-01-02', -10000);

    await setRate('2026-01-05', 0.9);

    // Still falls back to the earliest rate, which is now the new one
    expect(await getConvertedAmount(id)).toBe(-9000);
  });

  it('fills in converted amounts when the first rate arrives', async () => {
    const before = await addTransaction(usAccount, '2025-12-20', -10000);
    const after = await addTransaction(usAccount, '2026-01-05', -10000);

    await setRate('2026-01-01', 0.9);

    expect(await getConvertedAmount(before)).toBe(-9000);
    expect(await getConvertedAmount(after)).toBe(-9000);
  });

  it('updates converted amounts when a rate is deleted', async () => {
    await setRate('2026-01-01', 0.9);
    const rateId = await handlers['exchange-rate-set']({
      date: '2026-01-10',
      from_currency: 'USD',
      to_currency: 'EUR',
      rate: 0.95,
    });
    const id = await addTransaction(usAccount, '2026-01-12', -10000);

    await handlers['exchange-rate-delete']({ id: rateId });

    expect(await getConvertedAmount(id)).toBe(-9000);
  });

  it("updates converted amounts when an account's currency changes", async () => {
    await setRate('2026-01-01', 0.9);
    const id = await addTransaction(mainAccount, '2026-01-05', -10000);

    await handlers['account-update']({
      id: mainAccount,
      currency: 'USD',
    });
    expect(await getConvertedAmount(id)).toBe(-9000);

    await handlers['account-update']({
      id: mainAccount,
      currency: null,
    });
    expect(await getConvertedAmount(id)).toBeNull();
  });

  it('updates converted amounts when the main currency changes', async () => {
    await setRate('2026-01-01', 0.9);
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    await handlers['preferences/save']({
      id: 'defaultCurrencyCode',
      value: 'USD',
    });
    expect(await getConvertedAmount(id)).toBeNull();

    await handlers['preferences/save']({
      id: 'defaultCurrencyCode',
      value: 'EUR',
    });
    expect(await getConvertedAmount(id)).toBe(-9000);
  });
});

describe('latest rates', () => {
  let usAccount: string;
  let mainAccount: string;

  async function getLatestRates() {
    const { data } = await aqlQuery(
      q('accounts').select(['id', 'latest_rate']),
    );
    return Object.fromEntries(
      (data as Array<{ id: string; latest_rate: number }>).map(row => [
        row.id,
        row.latest_rate,
      ]),
    );
  }

  async function getTotalBalance() {
    const { data, dependencies } = await aqlQuery(
      q('transactions').calculate({
        $round: { $sum: { $mul: ['$amount', '$account.latest_rate'] } },
      }),
    );
    return { total: data as number, dependencies };
  }

  beforeEach(async () => {
    await setMainCurrency('EUR');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    mainAccount = await handlers['account-create']({
      name: 'Main',
    });
  });

  it('gives each account the latest rate to the main currency', async () => {
    await setRate('2026-01-01', 0.9);
    await setRate('2026-01-10', 0.95);

    expect(await getLatestRates()).toEqual({
      [usAccount]: 0.95,
      [mainAccount]: 1,
    });
  });

  it('inverts a rate stored the other way round', async () => {
    await handlers['exchange-rate-set']({
      date: '2026-01-01',
      from_currency: 'EUR',
      to_currency: 'USD',
      rate: 1.25,
    });

    expect((await getLatestRates())[usAccount]).toBeCloseTo(0.8);
  });

  it('uses a rate of 0 when no rate is known', async () => {
    expect((await getLatestRates())[usAccount]).toBe(0);
  });

  it('totals balances at the latest rate', async () => {
    await setRate('2026-01-01', 0.9);
    await setRate('2026-01-10', 0.95);
    await addTransaction(usAccount, '2026-01-05', 10000);
    await addTransaction(usAccount, '2026-01-12', 333);
    await addTransaction(mainAccount, '2026-01-05', 5000);

    const { total, dependencies } = await getTotalBalance();

    // 10,333 × 0.95 = 9,816.35, plus 5,000 in the main currency
    expect(total).toBe(14816);
    expect(dependencies).toEqual(
      expect.arrayContaining(['transactions', 'accounts', 'exchange_rates']),
    );
  });
});

describe('amounts in totals', () => {
  let usAccount: string;
  let mainAccount: string;

  async function getMainAmount(id: string) {
    const { data } = await aqlQuery(
      q('transactions')
        .filter({ id })
        .options({ splits: 'all' })
        .select(['main_amount', 'converted_amount']),
    );
    return (
      data as Array<{ main_amount: number; converted_amount: number | null }>
    )[0];
  }

  beforeEach(async () => {
    await setMainCurrency('EUR');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    mainAccount = await handlers['account-create']({ name: 'Main' });
  });

  it('leaves out amounts in another currency without a rate', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    expect(await getMainAmount(id)).toMatchObject({
      main_amount: 0,
      converted_amount: null,
    });
  });

  it('counts them again once a rate is known', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    await setRate('2026-01-01', 0.9);

    expect((await getMainAmount(id)).main_amount).toBe(-9000);
  });

  it('counts amounts in the main currency as they are', async () => {
    const id = await addTransaction(mainAccount, '2026-01-05', -10000);

    expect((await getMainAmount(id)).main_amount).toBe(-10000);
  });

  it('counts every amount as it is when there is no main currency', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    await setMainCurrency('');

    expect((await getMainAmount(id)).main_amount).toBe(-10000);
  });

  it('adds up the parts of a split for the parent', async () => {
    await setRate('2026-01-01', 0.9);
    const parent = await db.insertTransaction({
      account: usAccount,
      date: '2026-01-05',
      amount: -188,
      is_parent: true,
    });
    for (const [id, amount] of [
      ['a', -63],
      ['b', -63],
      ['c', -62],
    ] as const) {
      await db.insertTransaction({
        id: `${parent}/${id}`,
        account: usAccount,
        date: '2026-01-05',
        amount,
        is_child: true,
        parent_id: parent,
      });
    }

    // Each part rounds on its own: -57, -57 and -56 give -170, not -169
    expect(await getMainAmount(parent)).toMatchObject({
      main_amount: -170,
      converted_amount: -170,
    });
  });

  it('shows no conversion on a split without a rate', async () => {
    const parent = await db.insertTransaction({
      account: usAccount,
      date: '2026-01-05',
      amount: -100,
      is_parent: true,
    });
    await db.insertTransaction({
      id: `${parent}/a`,
      account: usAccount,
      date: '2026-01-05',
      amount: -100,
      is_child: true,
      parent_id: parent,
    });

    expect(await getMainAmount(parent)).toMatchObject({
      main_amount: 0,
      converted_amount: null,
    });
  });
});
