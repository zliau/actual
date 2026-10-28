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

async function getTransferPayee(account: string) {
  const row = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [account],
  );
  return row!.id;
}

async function getSide(id: string) {
  return db.first<
    Pick<db.DbTransaction, 'acct' | 'amount' | 'converted_amount'>
  >('SELECT acct, amount, converted_amount FROM transactions WHERE id = ?', [
    id,
  ]);
}

async function getOtherSide(id: string) {
  const row = await db.first<Pick<db.DbTransaction, 'transferred_id'>>(
    'SELECT transferred_id FROM transactions WHERE id = ?',
    [id],
  );
  return getSide(row!.transferred_id!);
}

describe('transfers between currencies', () => {
  let usAccount: string;
  let ukAccount: string;
  let mainAccount: string;
  let otherMainAccount: string;

  beforeEach(async () => {
    await setMainCurrency('EUR');
    usAccount = await handlers['account-create']({
      name: 'US',
      currency: 'USD',
    });
    ukAccount = await handlers['account-create']({
      name: 'UK',
      currency: 'GBP',
    });
    mainAccount = await handlers['account-create']({ name: 'Main' });
    otherMainAccount = await handlers['account-create']({ name: 'Other' });
    await handlers['exchange-rate-set']({
      date: '2026-01-01',
      from_currency: 'USD',
      to_currency: 'EUR',
      rate: 0.9,
    });
    await handlers['exchange-rate-set']({
      date: '2026-01-01',
      from_currency: 'GBP',
      to_currency: 'EUR',
      rate: 1.2,
    });
  });

  async function addTransfer(from: string, to: string, amount: number) {
    await handlers['transactions-batch-update']({
      added: [
        {
          id: 'sent',
          account: from,
          date: '2026-01-05',
          amount,
          payee: await getTransferPayee(to),
        },
      ],
    });
    return 'sent';
  }

  async function updateAmount(id: string, amount: number) {
    const transaction = await db.getTransaction(id);
    await handlers['transactions-batch-update']({
      updated: [{ ...transaction, amount }],
    });
  }

  it('estimates the received amount at the exchange rate', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);

    expect(await getOtherSide(id)).toEqual({
      acct: mainAccount,
      amount: 9000,
      converted_amount: null,
    });
  });

  it('estimates through the main currency between two other currencies', async () => {
    const id = await addTransfer(ukAccount, usAccount, -9000);

    // 90 GBP is 108 EUR, which is 120 USD
    expect((await getOtherSide(id))?.amount).toBe(12000);
  });

  it('mirrors the amount when no rate is known', async () => {
    const jpAccount = await handlers['account-create']({
      name: 'JP',
      currency: 'JPY',
    });

    const id = await addTransfer(jpAccount, mainAccount, -10000);

    expect((await getOtherSide(id))?.amount).toBe(10000);
  });

  it('keeps the amount entered on each side', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);
    const received = (await db.getTransaction(id)).transfer_id;

    // The bank actually paid out 91.50 EUR
    await updateAmount(received, 9150);
    expect((await getSide(id))?.amount).toBe(-10000);

    await updateAmount(id, -10100);
    expect((await getSide(received))?.amount).toBe(9150);
  });

  it('keeps the two sides flowing in opposite directions', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);

    await updateAmount(id, 10000);

    expect((await getOtherSide(id))?.amount).toBe(-9000);
  });

  it('converts the foreign side at the amount received in the main currency', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);
    const received = (await db.getTransaction(id)).transfer_id;

    await updateAmount(received, 9150);

    expect((await getSide(id))?.converted_amount).toBe(-9150);
  });

  it('keeps the conversion when the exchange rates change', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);

    await handlers['exchange-rate-set']({
      date: '2026-01-02',
      from_currency: 'USD',
      to_currency: 'EUR',
      rate: 0.95,
    });

    expect((await getSide(id))?.converted_amount).toBe(-9000);
  });

  it('converts both sides at the rates between two other currencies', async () => {
    const id = await addTransfer(ukAccount, usAccount, -9000);

    expect((await getSide(id))?.converted_amount).toBe(-10800);
    expect((await getOtherSide(id))?.converted_amount).toBe(10800);
  });

  it('converts the other side again when an account changes currency', async () => {
    const id = await addTransfer(usAccount, mainAccount, -10000);

    await handlers['account-update']({ id: mainAccount, currency: 'GBP' });

    // Now a transfer between USD and GBP, so both sides use the rates
    expect((await getSide(id))?.converted_amount).toBe(-9000);
    expect((await getOtherSide(id))?.converted_amount).toBe(10800);
  });

  it('still mirrors transfers in the same currency', async () => {
    const id = await addTransfer(mainAccount, otherMainAccount, -10000);
    await updateAmount(id, -12000);

    expect((await getOtherSide(id))?.amount).toBe(12000);
  });
});
