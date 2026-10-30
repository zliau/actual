import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Totals across accounts must add up amounts in the main currency. Adding up
// `amount` is only right within one account, so every place that does it has
// to be listed here with the reason. A new one fails this test until someone
// decides which it should be.
const ALLOWED_NATIVE_SUMS: Record<string, { count: number; reason: string }> = {
  'packages/desktop-client/src/accounts/reconciliation.ts': {
    count: 1,
    reason: 'Reconciles one account against its bank balance',
  },
  'packages/desktop-client/src/components/accounts/Account.tsx': {
    count: 3,
    reason: 'Running balance and filtered totals within one account',
  },
  'packages/desktop-client/src/components/accounts/Balance.tsx': {
    count: 1,
    reason: 'Selected balance within one account',
  },
  'packages/desktop-client/src/components/accounts/BalanceHistoryGraph.tsx': {
    count: 2,
    reason: 'Balance history of one account',
  },
  'packages/desktop-client/src/components/reports/spreadsheets/crossover-spreadsheet.ts':
    {
      count: 2,
      reason: 'Per-account balances, converted at the end of each month',
    },
  'packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts':
    {
      count: 2,
      reason: 'Per-account balances, converted at the end of each interval',
    },
  'packages/desktop-client/src/components/reports/spreadsheets/spending-spreadsheet.ts':
    {
      count: 1,
      reason: 'Budgeted amounts, which are already in the main currency',
    },
  'packages/desktop-client/src/hooks/useFormulaExecution.ts': {
    count: 1,
    reason: 'KNOWN GAP: formula balances stay in the account currency',
  },
  'packages/desktop-client/src/spreadsheet/bindings.ts': {
    count: 4,
    reason:
      'Balances of one account, and the $mul by the rate in sumInMainCurrency',
  },
  'packages/loot-core/src/server/forecast/forecast-accounts.ts': {
    count: 1,
    reason: 'The $mul by the rate of the forecast starting balance',
  },
  'packages/loot-core/src/server/transactions/transaction-rules.ts': {
    count: 1,
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

describe('sums of amounts in the account currency', () => {
  it('only happen where they were checked to be right', () => {
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED_NATIVE_SUMS).map(([file, { count }]) => [
        file,
        count,
      ]),
    );

    expect(findNativeSums()).toEqual(allowed);
  });
});
