import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/main';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

async function setMainCurrency(code: string) {
  await handlers['preferences/save']({
    id: 'defaultCurrencyCode',
    value: code,
  });
}

async function getCurrency(id: string) {
  const row = await db.first<Pick<db.DbAccount, 'currency'>>(
    'SELECT currency FROM accounts WHERE id = ?',
    [id],
  );
  return row?.currency;
}

describe('account currencies', () => {
  describe('insertAccount', () => {
    it('gives an account without a currency the main currency', async () => {
      await setMainCurrency('USD');

      const id = await db.insertAccount({ name: 'Checking' });

      expect(await getCurrency(id)).toBe('USD');
    });

    it('keeps the currency of an account that has one', async () => {
      await setMainCurrency('USD');

      const id = await db.insertAccount({ name: 'Euro', currency: 'EUR' });

      expect(await getCurrency(id)).toBe('EUR');
    });

    it('leaves the currency blank when there is no main currency', async () => {
      const id = await db.insertAccount({ name: 'Checking' });

      expect(await getCurrency(id)).toBeNull();
    });

    it('gives accounts created through the handler the main currency', async () => {
      await setMainCurrency('USD');

      const id = await handlers['account-create']({ name: 'Checking' });

      expect(await getCurrency(id)).toBe('USD');
    });
  });

  describe('setBlankAccountCurrencies', () => {
    it('stamps accounts without a currency, including deleted ones', async () => {
      const blank = await db.insertAccount({ name: 'Blank' });
      const deleted = await db.insertAccount({ name: 'Deleted' });
      await db.deleteAccount({ id: deleted });
      const euro = await db.insertAccount({ name: 'Euro', currency: 'EUR' });

      const count = await db.setBlankAccountCurrencies('USD');

      expect(count).toBe(2);
      expect(await getCurrency(blank)).toBe('USD');
      expect(await getCurrency(deleted)).toBe('USD');
      expect(await getCurrency(euro)).toBe('EUR');
    });

    it('does nothing when every account has a currency', async () => {
      await setMainCurrency('USD');
      await db.insertAccount({ name: 'Checking' });

      expect(await db.setBlankAccountCurrencies('USD')).toBe(0);
    });

    it('does nothing when there is no main currency', async () => {
      const id = await db.insertAccount({ name: 'Checking' });

      expect(await db.setBlankAccountCurrencies(null)).toBe(0);
      expect(await db.setBlankAccountCurrencies('')).toBe(0);
      expect(await getCurrency(id)).toBeNull();
    });
  });

  describe('changing the main currency', () => {
    it('stamps blank accounts with the new currency when none was set', async () => {
      const id = await db.insertAccount({ name: 'Checking' });

      await setMainCurrency('USD');

      expect(await getCurrency(id)).toBe('USD');
    });

    it('does not stamp anything when the currency is cleared', async () => {
      const id = await db.insertAccount({ name: 'Checking' });

      await setMainCurrency('');

      expect(await getCurrency(id)).toBeNull();
    });

    it('keeps accounts in the old currency and converts them', async () => {
      const blank = await db.insertAccount({ name: 'Blank' });
      await setMainCurrency('USD');
      const created = await handlers['account-create']({ name: 'Created' });
      const cadAccount = await handlers['account-create']({
        name: 'CAD',
        currency: 'CAD',
      });
      for (const account of [blank, created]) {
        await db.insertTransaction({
          account,
          date: '2026-01-05',
          amount: 10000,
        });
      }
      const cadTransaction = await db.insertTransaction({
        account: cadAccount,
        date: '2026-01-05',
        amount: 10000,
      });
      await handlers['exchange-rate-set']({
        date: '2026-01-01',
        from_currency: 'USD',
        to_currency: 'CAD',
        rate: 1.5,
      });

      await setMainCurrency('CAD');

      expect(await getCurrency(blank)).toBe('USD');
      expect(await getCurrency(created)).toBe('USD');
      const rows = await db.all<
        Pick<db.DbTransaction, 'id' | 'converted_amount'>
      >('SELECT id, converted_amount FROM transactions WHERE tombstone = 0');
      const converted = Object.fromEntries(
        rows.map(row => [row.id, row.converted_amount]),
      );
      expect(Object.values(converted).filter(v => v === 15000)).toHaveLength(2);
      expect(converted[cadTransaction]).toBeNull();
    });
  });
});
