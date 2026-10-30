import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Totals across accounts must add up amounts in the base currency, by querying
// with `.options({ currency: 'base' })`. Adding up `amount` without it is only
// right within one account. Every place that adds up `$amount` is listed here
// with how many of its sums are in the account currency (`native`) and how
// many use the base currency option (`base`), so a new one fails this test
// until someone decides which it should be.
const ALLOWED_SUMS: Record<
  string,
  { native?: number; base?: number; reason: string }
> = {
  'packages/desktop-client/src/accounts/reconciliation.ts': {
    native: 1,
    reason: 'Reconciles one account against its bank balance',
  },
  'packages/desktop-client/src/components/accounts/Account.tsx': {
    native: 3,
    reason:
      'Running balance and filtered totals within one account; the filtered total switches to the base currency across accounts',
  },
  'packages/desktop-client/src/components/accounts/Balance.tsx': {
    native: 1,
    reason:
      'Selected balance within one account, or in the base currency across accounts',
  },
  'packages/desktop-client/src/components/accounts/BalanceHistoryGraph.tsx': {
    native: 2,
    reason: 'Balance history of one account',
  },
  'packages/desktop-client/src/components/reports/spreadsheets/calendar-spreadsheet.ts':
    { base: 1, reason: 'Daily totals across accounts' },
  'packages/desktop-client/src/components/reports/spreadsheets/cash-flow-spreadsheet.tsx':
    { base: 4, reason: 'Income and expense totals across accounts' },
  'packages/desktop-client/src/components/reports/spreadsheets/crossover-spreadsheet.ts':
    {
      native: 2,
      base: 1,
      reason:
        'Per-account balances, converted at the end of each month, and expense totals',
    },
  'packages/desktop-client/src/components/reports/spreadsheets/makeQuery.ts': {
    base: 1,
    reason: 'Custom report totals across accounts',
  },
  'packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts':
    {
      native: 2,
      reason: 'Per-account balances, converted at the end of each interval',
    },
  'packages/desktop-client/src/components/reports/spreadsheets/sankey-spreadsheet.ts':
    { base: 1, reason: 'Category totals across accounts' },
  'packages/desktop-client/src/components/reports/spreadsheets/spending-spreadsheet.ts':
    {
      native: 1,
      reason: 'Budgeted amounts, which are already in the base currency',
    },
  'packages/desktop-client/src/components/reports/spreadsheets/summary-spreadsheet.ts':
    { base: 2, reason: 'Summary card totals across accounts' },
  'packages/desktop-client/src/hooks/useFormulaExecution.ts': {
    base: 1,
    reason: 'Formula query totals across accounts',
  },
  'packages/desktop-client/src/spreadsheet/bindings.ts': {
    native: 4,
    base: 4,
    reason:
      'Balances of one account, the $mul by the rate in sumInMainCurrency, and category totals',
  },
  'packages/loot-core/src/server/forecast/forecast-accounts.ts': {
    native: 1,
    reason: 'The $mul by the rate of the forecast starting balance',
  },
  'packages/loot-core/src/server/transactions/transaction-rules.ts': {
    native: 1,
    reason: 'Balance of one account for rule templates',
  },
};

function findNativeSums() {
  const root = path.resolve(__dirname, '../../../..');
  const output = execFileSync(
    'git',
    [
      'grep',
      '-c',
      '-E',
      "'\\$amount'",
      '--',
      'packages/desktop-client/src',
      'packages/loot-core/src/server',
      'packages/loot-core/src/shared',
      ':!*.test.*',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map(line => {
        const [file, count] = line.split(':');
        return [file, Number(count)];
      }),
  );
}

describe('sums of amounts', () => {
  it('only happen where their currency was checked to be right', () => {
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED_SUMS).map(([file, { native = 0, base = 0 }]) => [
        file,
        native + base,
      ]),
    );

    expect(findNativeSums()).toEqual(allowed);
  });
});
