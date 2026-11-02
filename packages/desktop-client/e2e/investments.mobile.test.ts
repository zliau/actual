import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

test.describe('Mobile investment accounts', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 350, height: 600 } });
    await page.goto('/');
    await new ConfigurationPage(page).startFresh();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('shows holdings on an investment account', async () => {
    await page.goto('/accounts');
    await page.getByRole('button', { name: 'Add account' }).first().click();
    const local = page.getByRole('button', { name: 'Create a local account' });
    if (await local.isVisible({ timeout: 2000 }).catch(() => false)) {
      await local.click();
    }
    const dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Name').fill('Brokerage');
    await dialog.getByLabel('Investment account').click();
    await dialog.getByLabel('Starting cash').fill('5000');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('No holdings yet')).toBeVisible();
    await expect(page.getByText(/Cash.*5,000\.00/)).toBeVisible();

    await page.getByRole('button', { name: 'Add trade' }).click();
    const trade = page.getByRole('dialog');
    await trade.getByLabel('Symbol').fill('AAPL');
    await trade.getByLabel('Shares').fill('10');
    await trade.getByLabel('Price').fill('100');
    await trade.getByRole('button', { name: 'Save' }).click();

    const holding = page.getByRole('button', { name: 'Open AAPL' });
    await expect(holding).toContainText('10 shares');
    await expect(holding).toContainText('1,000.00');
    await expect(page.getByText(/Cash.*4,000\.00/)).toBeVisible();
  });

  test('opens a holding to add a price', async () => {
    await page.getByRole('button', { name: 'Open AAPL' }).click();
    await page.getByRole('button', { name: 'Add price' }).click();
    await page.getByRole('textbox', { name: 'Close' }).fill('120');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Close' }).click();

    const holding = page.getByRole('button', { name: 'Open AAPL' });
    await expect(holding).toContainText('1,200.00');
    await expect(holding).toContainText('+20.0%');
  });

  test('titles what trades write with their notes', async () => {
    await expect(page.getByText('Buy 10 AAPL @ 100')).toHaveCount(1);
    await expect(page.getByText('Market value 10 AAPL @ 120')).toHaveCount(1);
    await expect(page.getByText('(No payee)')).toHaveCount(0);
  });

  test("doesn't open what trades write for editing", async () => {
    const url = page.url();
    await page.getByText('Buy 10 AAPL @ 100').first().click();
    await expect(
      page.getByText('To change it, edit them in Holdings.'),
    ).toBeVisible();
    expect(page.url()).toBe(url);
  });
});
