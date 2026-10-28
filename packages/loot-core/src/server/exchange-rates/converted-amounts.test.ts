import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/main';

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

  it('fills in converted amounts when the first rate arrives', async () => {
    const id = await addTransaction(usAccount, '2026-01-05', -10000);

    await setRate('2026-01-01', 0.9);

    expect(await getConvertedAmount(id)).toBe(-9000);
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
