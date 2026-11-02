import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { AccountPage } from './page-models/account-page';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';
import { SettingsPage } from './page-models/settings-page';

// A budget with exact amounts, so that every screen can be compared with a
// number worked out by hand. One account is in USD at a rate of 0.5:
//
//                 Main (EUR)   US (USD)    Total in EUR    Unconverted
//   Starting      1000.00      1000.00     1500.00         2000.00
//   Food          -100.00      -100.00     -150.00         -200.00
//   Balance       900.00       900.00      1350.00         1800.00
//
// A screen that adds up the original amounts shows the last column instead.
function money(amount: number) {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '[.,\\s]?');
  return new RegExp(`(^|[^\\d.,])${grouped}[.,]${fraction}(?![\\d])`);
}

test.describe('Multiple currencies', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let page: Page;
  let navigation: Navigation;

  async function bodyText() {
    // Currency symbols are wrapped in invisible text direction marks
    return (await page.locator('body').innerText())
      .replace(/[\u202A-\u202E]/g, '')
      .replace(/\s+/g, ' ');
  }

  // Screens load at their own pace, so wait for the right amounts to show up
  // and only then check that the unconverted ones aren't there
  async function expectConverted(amounts: number[], wrong: number[] = []) {
    for (const amount of amounts) {
      await expect.poll(bodyText, { timeout: 20000 }).toMatch(money(amount));
    }
    const text = await bodyText();
    for (const amount of wrong) {
      expect(text).not.toMatch(money(amount));
    }
  }

  // Some reports only open from their card on the dashboard
  async function openCard(name: string | RegExp) {
    await page.goto('/reports');
    await page.waitForTimeout(2000);
    await page.getByText(name).first().click();
  }

  async function addAndOpenCard(menuItem: string, name: RegExp) {
    await page.goto('/reports');
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Add new widget' }).click();
    await page.getByText(menuItem, { exact: true }).click();
    await page.waitForTimeout(1500);
    await page.mouse.move(800, 500);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);
    await page.getByText(name).last().click();
  }

  async function enableFlag(name: string) {
    const flag = page.getByRole('checkbox', { name });
    if (!(await flag.isChecked())) {
      await flag.click();
    }
    await page.waitForTimeout(1500);
  }

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new Navigation(page);
    const configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.startFresh();

    await page.goto('/settings');
    const settingsNav = page.getByRole('navigation', { name: 'Settings' });
    await settingsNav
      .getByRole('link', { name: 'Experimental', exact: true })
      .click();
    await enableFlag('Currency support');
    await enableFlag('Sankey Report');
    await enableFlag('Balance Forecast Report');
    await enableFlag('Budget Analysis Report');
    await settingsNav
      .getByRole('link', { name: 'General', exact: true })
      .click();
    await page.waitForTimeout(1000);
    await page
      .getByTestId('settings')
      .getByRole('button', { name: /None/ })
      .first()
      .click();
    await page.getByText(/^EUR - Euro/).click();
    await page.waitForTimeout(1000);
    const welcome = page.getByText('Welcome to Actual!');
    if (await welcome.isVisible()) {
      await page.getByRole('button', { name: /Close/ }).last().click();
    }

    await navigation.createAccount({
      name: 'Main',
      offBudget: false,
      balance: 1000,
    });
    const mainPage = new AccountPage(page);
    await mainPage.createSingleTransaction({
      payee: 'Shop',
      category: 'Food',
      debit: '100',
    });
    await navigation.goToBudgetPage();
    await navigation.createAccount({
      name: 'US',
      offBudget: false,
      balance: 1000,
    });
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByText('Change currency', { exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Main currency/ })
      .click();
    await page.getByText(/^USD - US Dollar/).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save' })
      .click();
    await page
      .getByRole('button', { name: 'Add an exchange rate for this date' })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Rate' }).fill('0.5');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save' })
      .click();
    await page.waitForTimeout(1000);
    const usPage = new AccountPage(page);
    await usPage.createSingleTransaction({
      payee: 'Shop',
      category: 'Food',
      debit: '100',
    });
    await page.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('accounts sidebar', async () => {
    // All accounts and on budget, Main, then US with its converted balance
    await expectConverted([1350, 900, 450], [1800]);
    expect(await bodyText()).toMatch(/US\$\s?900[.,]00/);
  });

  test('account page', async () => {
    await navigation.goToAccountPage('US');
    await expectConverted([50, 500]);
    expect(await bodyText()).toMatch(/In EUR:\s?450[.,]00/);
    // The Converted column shows the main currency
    expect(await bodyText()).toMatch(/50[.,]00\s?€/);
  });

  test('reconciling shows the currency of the account', async () => {
    await navigation.goToAccountPage('US');
    await page
      .getByRole('button', { name: /reconcil/i })
      .first()
      .click();
    const balance = page.getByRole('dialog').getByRole('textbox');
    await expect(balance).toHaveValue(/US\$/);
    await balance.fill('950');
    await page.keyboard.press('Enter');
    await expect.poll(bodyText, { timeout: 20000 }).toMatch(/US\$\s?950[.,]00/);
    expect(await bodyText()).not.toMatch(/950[.,]00\s?€/);
    await page.getByRole('button', { name: 'Exit reconciliation' }).click();
  });

  test('command bar shows the currency of the account', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect
      .poll(bodyText, { timeout: 20000 })
      .toMatch(/US US\$\s?900[.,]00/);
    await page.keyboard.press('Escape');
  });

  test('all accounts page', async () => {
    await page.goto('/accounts');
    await expectConverted([1350], [1800]);
  });

  test('all accounts page shows the currency of each amount', async () => {
    await page.goto('/accounts');
    const table = page.getByTestId('transaction-table');
    const usRow = table.getByTestId('row').filter({ hasText: 'US' }).first();
    const mainRow = table
      .getByTestId('row')
      .filter({ hasText: 'Main' })
      .first();

    await expect(usRow.getByTestId('debit')).toHaveText(/US\$\D?100[.,]00/);
    await expect(mainRow.getByTestId('debit')).toHaveText(/100[.,]00\D?€/);

    // Editing still works with a plain number
    await usRow.getByTestId('debit').click();
    await expect(usRow.getByTestId('debit').getByRole('textbox')).toHaveValue(
      /^100[.,]00$/,
    );
    await page.keyboard.press('Escape');
  });

  test('account pages show the currency of each amount', async () => {
    await page.getByRole('link', { name: /^US/ }).first().click();
    const usRow = page
      .getByTestId('transaction-table')
      .getByTestId('row')
      .first();
    await expect(usRow.getByTestId('debit')).toHaveText(/US\$\D?100[.,]00/);

    await page.getByRole('link', { name: /^Main/ }).first().click();
    const mainRow = page
      .getByTestId('transaction-table')
      .getByTestId('row')
      .first();
    await expect(mainRow.getByTestId('debit')).toHaveText(/100[.,]00\D?€/);
  });

  test('envelope budget', async () => {
    await page.goto('/budget');
    await expectConverted([1500, 150], [2000, 200]);
  });

  test('dashboard cards', async () => {
    await page.goto('/reports');
    // Net worth, and income and expenses for the year
    await expectConverted([1350, 1500, 150], [1800, 2000, 200]);
  });

  test('net worth report', async () => {
    await page.goto('/reports/net-worth');
    await expectConverted([1350], [1800]);
  });

  test('cash flow report', async () => {
    await openCard('Cash Flow');
    await expectConverted([1500, 150], [2000, 200]);
  });

  test('custom report', async () => {
    await page.goto('/reports/custom');
    await expectConverted([150], [200]);
  });

  test('spending report', async () => {
    await openCard('This Month');
    await expectConverted([150], [200]);
  });

  test('sankey report', async () => {
    await page.goto('/reports/sankey');
    await expectConverted([150], [200]);
  });

  test('budget analysis report', async () => {
    await addAndOpenCard('Budget analysis', /budget analysis/i);
    await expectConverted([150], [200]);
  });

  test('balance forecast report', async () => {
    await page.goto('/reports/forecast');
    await expectConverted([1350], [1800]);
  });

  test('calendar report shows converted amounts', async () => {
    await addAndOpenCard('Calendar card', /^Calendar$/);
    const table = page.getByTestId('transaction-table');
    const usRow = table.getByTestId('row').filter({ hasText: 'US' }).first();
    const mainRow = table
      .getByTestId('row')
      .filter({ hasText: 'Main' })
      .first();

    await expect(usRow.getByTestId('debit')).toHaveText(/US\$\D?100[.,]00/);
    await expect(usRow.getByTestId('converted')).toHaveText(/50[.,]00\D?€/);
    await expect(mainRow.getByTestId('debit')).toHaveText(/100[.,]00\D?€/);
    await expect(mainRow.getByTestId('converted')).toHaveText(/100[.,]00\D?€/);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await expect.poll(bodyText, { timeout: 20000 }).toMatch(/US\$\D?100[.,]00/);
    expect(await bodyText()).toMatch(money(50));
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('age of money report', async () => {
    await page.goto('/reports/age-of-money');
    await expect.poll(bodyText, { timeout: 20000 }).toMatch(/\d+ days?/);
    expect(await bodyText()).not.toContain('Something internally went wrong');
  });

  test('mobile accounts and budget', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/accounts');
    await expectConverted([1350], [1800]);
    expect(await bodyText()).toMatch(/US\$\s?900[.,]00/);
    await page.goto('/budget');
    await expectConverted([150], [200]);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('tracking budget', async () => {
    await page.goto('/settings');
    await new SettingsPage(page).useBudgetType('Tracking');
    await page.goto('/budget');
    await expectConverted([150, 1500], [200, 2000]);
    // Only tracking budgets have a saved or overspent amount
    await expect.poll(bodyText, { timeout: 20000 }).toMatch(/Saved|Overspent/);
  });

  // Last because it changes the totals the other tests check
  test('mobile uncategorized banner', async () => {
    await navigation.goToAccountPage('US');
    await new AccountPage(page).createSingleTransaction({
      payee: 'Shop',
      debit: '100',
    });
    await page.waitForTimeout(1500);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/budget');
    const banner = page.getByText(/uncategorized transaction/);
    await expect(banner).toContainText(money(50), { timeout: 20000 });
    await expect(banner).not.toContainText(money(100));
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
