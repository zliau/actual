import { app } from '#server/accounts/app';
import { loadMappings } from '#server/db/mappings';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

describe('account currency', () => {
  it('defaults to the main currency', async () => {
    const id = await app.handlers['account-create']({ name: 'Checking' });

    const accounts = await app.handlers['accounts-get']();
    expect(accounts.find(account => account.id === id)?.currency).toBeNull();
  });

  it('can be set when the account is created', async () => {
    const id = await app.handlers['account-create']({
      name: 'US Checking',
      currency: 'USD',
    });

    const accounts = await app.handlers['accounts-get']();
    expect(accounts.find(account => account.id === id)?.currency).toBe('USD');
  });

  it('can be changed and reset to the main currency', async () => {
    const id = await app.handlers['account-create']({ name: 'Savings' });

    await app.handlers['account-update']({ id, currency: 'EUR' });
    let accounts = await app.handlers['accounts-get']();
    expect(accounts.find(account => account.id === id)?.currency).toBe('EUR');

    await app.handlers['account-update']({ id, currency: null });
    accounts = await app.handlers['accounts-get']();
    expect(accounts.find(account => account.id === id)?.currency).toBeNull();
  });

  it('rejects unknown currency codes', async () => {
    await expect(
      app.handlers['account-create']({ name: 'Checking', currency: 'XXX' }),
    ).rejects.toThrow(/unknown currency/);

    const id = await app.handlers['account-create']({ name: 'Savings' });
    await expect(
      app.handlers['account-update']({ id, currency: '' }),
    ).rejects.toThrow(/unknown currency/);
  });
});
