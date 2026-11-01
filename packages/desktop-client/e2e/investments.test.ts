import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

// Worked out by hand, with the app's clock fixed at 2017-01-01:
//
//   Starting cash                     5,000.00
//   Buy 10 AAPL @ 100 with a 5 fee   -1,005.00   cost 1,005, average 100.50
//   Close of 120                                 value 1,200, gain +195
//   Sell 4 AAPL @ 150 with no fee      +600.00   realized 600 - 402 = +198
//   Left: 6 shares                               value 720, cost 603, gain +117
test.describe('Investment accounts', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let page: Page;

  const holdingRow = () => page.getByRole('button', { name: 'Open AAPL' });

  async function fillTrade(fields: {
    symbol?: string;
    type?: 'Buy' | 'Sell';
    shares: string;
    price: string;
    fee?: string;
  }) {
    const dialog = page.getByRole('dialog');
    if (fields.type) {
      await dialog.getByRole('button', { name: 'Type' }).click();
      await page.getByText(fields.type, { exact: true }).last().click();
    }
    if (fields.symbol) {
      await dialog.getByLabel('Symbol').fill(fields.symbol);
    }
    await dialog.getByLabel('Shares').fill(fields.shares);
    await dialog.getByLabel('Price').fill(fields.price);
    await dialog.getByLabel('Fee').fill(fields.fee ?? '');
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('/');
    await new ConfigurationPage(page).startFresh();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('creates an investment account with cash', async () => {
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Brokerage');
    await dialog.getByLabel('Investment account').click();
    await expect(dialog.getByLabel('Off budget')).toBeChecked();
    await dialog.getByLabel('Starting cash').fill('5000');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('No holdings yet')).toBeVisible();
    await expect(page.getByText(/Cash.*5,000\.00/)).toBeVisible();
  });

  test('adds a buy and takes it from the cash', async () => {
    await page.getByRole('button', { name: 'Add trade' }).click();
    await fillTrade({ symbol: 'aapl', shares: '10', price: '100', fee: '5' });
    await expect(
      page.getByRole('dialog').getByText('Cash change'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(holdingRow()).toContainText('AAPL');
    await expect(holdingRow()).toContainText('100.50');
    await expect(holdingRow()).toContainText('1,000.00');
    await expect(page.getByText(/Cash.*3,995\.00/)).toBeVisible();
    await expect(page.getByText('Buy 10 AAPL @ 100')).toBeVisible();
  });

  test('values the holding at an entered price', async () => {
    await holdingRow().click();
    await page.getByRole('button', { name: 'Add price' }).click();
    await page.getByRole('textbox', { name: 'Close' }).fill('120');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Entered')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(holdingRow()).toContainText('1,200.00');
    await expect(holdingRow()).toContainText('195.00');
    await expect(holdingRow()).toContainText('+19.4%');
  });

  test('refuses to sell more than is held', async () => {
    await page.getByRole('button', { name: 'Add trade' }).click();
    await fillTrade({
      symbol: 'AAPL',
      type: 'Sell',
      shares: '11',
      price: '150',
    });
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(/more AAPL shares than/)).toBeVisible();
  });

  test('records a sell with its realized gain', async () => {
    await page.getByRole('dialog').getByLabel('Shares').fill('4');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(holdingRow()).toContainText('720.00');
    await expect(holdingRow()).toContainText('117.00');
    await expect(holdingRow()).toContainText('198.00');
    await expect(page.getByText(/Cash.*4,595\.00/)).toBeVisible();
  });

  test('removes a trade and its cash', async () => {
    await holdingRow().click();
    await page
      .getByRole('button', { name: /Edit the trade/ })
      .filter({ hasText: 'Sell' })
      .click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByText(/Cash.*3,995\.00/)).toBeVisible();
    await expect(holdingRow()).toContainText('1,200.00');
  });
});
