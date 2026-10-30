import {
  clearServer,
  initServer,
} from '@actual-app/core/platform/client/connection';
import type { ExchangeRateEntity } from '@actual-app/core/types/models';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCrossoverSpreadsheet } from './crossover-spreadsheet';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

type SpreadsheetData = Parameters<
  Parameters<ReturnType<typeof createCrossoverSpreadsheet>>[1]
>[0];

const exchangeRates: ExchangeRateEntity[] = [
  {
    id: 'july',
    date: '2026-07-01',
    from_currency: 'USD',
    to_currency: 'EUR',
    rate: 0.9,
    source: 'api',
  },
  {
    id: 'august',
    date: '2026-08-15',
    from_currency: 'USD',
    to_currency: 'EUR',
    rate: 0.8,
    source: 'api',
  },
];

async function runReport({
  rates,
  mainCurrency,
}: {
  rates: ExchangeRateEntity[];
  mainCurrency: string | null;
}) {
  initServer({
    'exchange-rates-get': async ({ from_currency, to_currency } = {}) =>
      rates.filter(
        rate =>
          rate.from_currency === from_currency &&
          rate.to_currency === to_currency,
      ),
    query: async query => {
      if (query.table === 'accounts') {
        return {
          data: [
            { id: 'main', currency: null },
            { id: 'us', currency: 'USD' },
          ],
          dependencies: [],
        };
      }
      // Each account's balance is only a starting amount, with no later changes
      const accountFilter = query.filterExpressions.find(
        expression => 'account' in expression,
      );
      if (query.calculation) {
        return {
          data: accountFilter?.account === 'us' ? 100_000 : 50_000,
          dependencies: [],
        };
      }
      return { data: [], dependencies: [] };
    },
  });

  let report: SpreadsheetData | undefined;
  const spreadsheet = createCrossoverSpreadsheet({
    start: '2026-07',
    end: '2026-08',
    expenseCategoryIds: [],
    incomeAccountIds: ['main', 'us'],
    safeWithdrawalRate: 0.04,
    projectionType: 'mean',
    mainCurrency,
  });

  // The crossover factory does not use its spreadsheet dependency.
  await spreadsheet(undefined as never, data => {
    report = data;
  });

  if (!report) {
    throw new Error('Spreadsheet did not produce report data');
  }
  return report.graphData.data
    .filter(point => !point.isProjection)
    .map(point => point.nestEgg);
}

afterEach(async () => {
  await clearServer();
});

describe('crossover balances in the main currency', () => {
  it('values accounts in another currency at the rate at the end of each month', async () => {
    expect(
      await runReport({ rates: exchangeRates, mainCurrency: 'EUR' }),
    ).toEqual([140_000, 130_000]);
  });

  it('leaves out accounts in a currency without a rate', async () => {
    expect(await runReport({ rates: [], mainCurrency: 'EUR' })).toEqual([
      50_000, 50_000,
    ]);
  });

  it('adds up the original amounts when no main currency is set', async () => {
    expect(await runReport({ rates: [], mainCurrency: null })).toEqual([
      150_000, 150_000,
    ]);
  });
});
