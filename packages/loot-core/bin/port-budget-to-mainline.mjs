#!/usr/bin/env node
// Ports a budget exported from the multi-currency branches so mainline Actual
// can use it. Mainline adds up raw amounts, so transactions in foreign accounts
// are rewritten in the main currency, and everything mainline doesn't know is
// removed. The input file is never changed: keep it as the record of the
// original amounts and exchange rates.
//
// Usage, from the repository root:
//   node packages/loot-core/bin/port-budget-to-mainline.mjs <export.zip> <output.zip>
//     [--dry-run] [--fix-transfers]
//
// Import the output into mainline with "Import my budget" > "Actual". It becomes
// a new budget with its own sync history, so other devices must switch to it.

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { unzipSync, zipSync } from 'fflate';

const BRANCH_MIGRATIONS = [
  1793155693196, // add_multi_currency
  1793156741434, // add_converted_amount
];
const BRANCH_TABLES = ['exchange_rates'];
const BRANCH_COLUMNS = [
  ['accounts', 'currency'],
  ['transactions', 'converted_amount'],
];
// The same tables the app's own sync reset clears of deleted rows
const TOMBSTONED_TABLES = [
  'transactions',
  'accounts',
  'payees',
  'categories',
  'category_groups',
  'schedules',
  'rules',
];
const ADJUSTMENT_NOTE = 'Balance adjustment from converting to main currency';

class PortError extends Error {}

function money(value) {
  return (value / 100).toFixed(2);
}

function readArchive(path) {
  const entries = unzipSync(readFileSync(path));
  const names = Object.keys(entries);
  const dirs = names
    .filter(name => name === 'db.sqlite' || name.endsWith('/db.sqlite'))
    .map(name => name.slice(0, -'db.sqlite'.length))
    .filter(dir => names.includes(`${dir}metadata.json`));
  const dir = dirs.includes('') ? '' : dirs.length === 1 ? dirs[0] : null;
  if (dir == null) {
    throw new PortError(
      `${path} is not a budget export: no db.sqlite with metadata.json`,
    );
  }
  return {
    db: entries[`${dir}db.sqlite`],
    meta: JSON.parse(
      Buffer.from(entries[`${dir}metadata.json`]).toString('utf8'),
    ),
  };
}

function hasTable(db, name) {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) != null
  );
}

function hasColumn(db, table, column) {
  return db
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .some(row => row.name === column);
}

// Same order as `latest_rate` in the accounts view
function getLatestRate(db, currency, mainCurrency) {
  const row = db
    .prepare(
      `SELECT CASE WHEN from_currency = :currency THEN rate ELSE 1.0 / rate END AS rate
       FROM exchange_rates
       WHERE tombstone = 0 AND rate > 0 AND (
         (from_currency = :currency AND to_currency = :main) OR
         (from_currency = :main AND to_currency = :currency)
       )
       ORDER BY date DESC, CASE source WHEN 'manual' THEN 0 ELSE 1 END,
         to_currency = :main DESC, id
       LIMIT 1`,
    )
    .get({ currency, main: mainCurrency });
  return row?.rate ?? null;
}

function getBalance(db, accountId) {
  return db
    .prepare(
      `SELECT IFNULL(SUM(amount), 0) AS balance FROM transactions
       WHERE acct = ? AND isParent = 0 AND tombstone = 0`,
    )
    .get(accountId).balance;
}

function getForeignAccounts(db, mainCurrency) {
  const accounts = db
    .prepare(
      `SELECT id, name, currency, offbudget, account_id, closed FROM accounts
       WHERE tombstone = 0 AND currency IS NOT NULL AND currency != ''
         AND currency != ?`,
    )
    .all(mainCurrency ?? '');
  if (accounts.length > 0 && !mainCurrency) {
    throw new PortError(
      'Accounts have their own currency but the budget has no main currency.',
    );
  }
  return accounts.map(account => ({
    ...account,
    rate: getLatestRate(db, account.currency, mainCurrency),
    nativeBalance: getBalance(db, account.id),
  }));
}

function getMissingConversions(db, accountIds) {
  const select = db.prepare(
    `SELECT t.date, t.amount, a.name AS account FROM transactions t
     JOIN accounts a ON a.id = t.acct
     WHERE t.acct = ? AND t.isParent = 0 AND t.tombstone = 0
       AND t.converted_amount IS NULL AND IFNULL(t.amount, 0) != 0
     ORDER BY t.date`,
  );
  return accountIds.flatMap(id => select.all(id));
}

function convertTransactions(db, accountIds) {
  const update = db.prepare(
    `UPDATE transactions SET amount = IFNULL(converted_amount, 0)
     WHERE acct = ? AND isParent = 0 AND tombstone = 0`,
  );
  return accountIds.reduce((count, id) => count + update.run(id).changes, 0);
}

function findBrokenTransfers(db, accountIds) {
  return db
    .prepare(
      `SELECT a.id AS aId, a.amount AS aAmount, a.date, a.acct AS aAcct,
         aa.name AS aName, b.id AS bId, b.amount AS bAmount, b.acct AS bAcct,
         ba.name AS bName
       FROM transactions a
       JOIN transactions b ON b.id = a.transferred_id
       JOIN accounts aa ON aa.id = a.acct
       JOIN accounts ba ON ba.id = b.acct
       WHERE a.id < b.id AND a.tombstone = 0 AND b.tombstone = 0
         AND a.amount != -b.amount`,
    )
    .all()
    .filter(
      transfer =>
        accountIds.includes(transfer.aAcct) ||
        accountIds.includes(transfer.bAcct),
    );
}

// Moves the difference onto a foreign account, so main currency accounts keep
// the amounts they really had
function fixTransfers(db, transfers, accountIds) {
  const update = db.prepare(`UPDATE transactions SET amount = ? WHERE id = ?`);
  for (const transfer of transfers) {
    if (accountIds.includes(transfer.bAcct)) {
      update.run(-transfer.aAmount, transfer.bId);
    } else {
      update.run(-transfer.bAmount, transfer.aId);
    }
  }
}

// A parent must always add up to its parts
function updateSplitParents(db, accountIds) {
  const update = db.prepare(
    `UPDATE transactions SET amount = (
       SELECT IFNULL(SUM(c.amount), 0) FROM transactions c
       WHERE c.parent_id = transactions.id AND c.isChild = 1 AND c.tombstone = 0
     )
     WHERE acct = ? AND isParent = 1 AND tombstone = 0`,
  );
  for (const id of accountIds) {
    update.run(id);
  }
}

function convertAmountCondition(value, rate) {
  if (typeof value === 'number') {
    return Math.round(value * rate);
  }
  if (value && typeof value === 'object' && 'num1' in value) {
    return {
      ...value,
      num1: Math.round(value.num1 * rate),
      num2: Math.round(value.num2 * rate),
    };
  }
  return value;
}

// Schedules store the amount they expect in the rule that matches them
function convertSchedules(db, accounts) {
  const ratesByAccount = new Map(accounts.map(a => [a.id, a.rate]));
  const schedules = db
    .prepare(
      `SELECT s.name, r.id AS ruleId, r.conditions FROM schedules s
       JOIN rules r ON r.id = s.rule
       WHERE s.tombstone = 0 AND r.tombstone = 0`,
    )
    .all();
  const update = db.prepare(`UPDATE rules SET conditions = ? WHERE id = ?`);
  const unconverted = [];
  let converted = 0;

  for (const schedule of schedules) {
    const conditions = JSON.parse(schedule.conditions ?? '[]');
    const account = conditions.find(
      c => c.field === 'account' || c.field === 'acct',
    );
    if (!account || !ratesByAccount.has(account.value)) {
      continue;
    }
    const rate = ratesByAccount.get(account.value);
    if (rate == null) {
      unconverted.push(schedule.name ?? schedule.ruleId);
      continue;
    }
    for (const condition of conditions) {
      if (condition.field === 'amount') {
        condition.value = convertAmountCondition(condition.value, rate);
      }
    }
    update.run(JSON.stringify(conditions), schedule.ruleId);
    converted++;
  }
  return { converted, unconverted };
}

// Every transaction converted at its own date's rate, so the sum isn't what the
// account is worth today. One transaction per account makes up the difference.
function addBalanceAdjustments(db, accounts) {
  const today = new Date();
  const date =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();
  const insert = db.prepare(
    `INSERT INTO transactions
       (id, acct, amount, notes, date, sort_order, cleared, isParent, isChild,
        starting_balance_flag, tombstone)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0)`,
  );

  return accounts.map(account => {
    const converted = getBalance(db, account.id);
    const target =
      account.rate == null
        ? converted
        : Math.round(account.nativeBalance * account.rate);
    const adjustment = target - converted;
    if (adjustment !== 0) {
      insert.run(
        randomUUID(),
        account.id,
        adjustment,
        ADJUSTMENT_NOTE,
        date,
        Date.now(),
      );
    }
    return { ...account, converted, adjustment, final: target };
  });
}

function countRows(db, table) {
  return db
    .prepare(
      hasColumn(db, table, 'tombstone')
        ? `SELECT COUNT(*) AS count FROM "${table}" WHERE tombstone = 0`
        : `SELECT COUNT(*) AS count FROM "${table}"`,
    )
    .get().count;
}

function removeBranchSchema(db) {
  const removed = {};
  // Views use the columns being dropped. Without a stored hash the app
  // recreates its own views when it opens the budget.
  const views = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'view'`)
    .all();
  for (const { name } of views) {
    db.exec(`DROP VIEW "${name}"`);
  }
  db.prepare(`DELETE FROM __meta__ WHERE key = 'view-hash'`).run();

  for (const table of BRANCH_TABLES) {
    if (hasTable(db, table)) {
      removed[table] = countRows(db, table);
      db.exec(`DROP TABLE "${table}"`);
    }
  }
  for (const [table, column] of BRANCH_COLUMNS) {
    if (hasColumn(db, table, column)) {
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
    }
  }
  const deleteMigration = db.prepare(`DELETE FROM __migrations__ WHERE id = ?`);
  for (const id of BRANCH_MIGRATIONS) {
    deleteMigration.run(id);
  }
  return removed;
}

// Old sync messages would bring the removed data back. This clears the same
// things as the app's own sync reset, and the budget syncs as a new file.
function clearSyncHistory(db) {
  for (const table of [
    'messages_crdt',
    'messages_clock',
    'messages_pending',
    'kvcache',
    'kvcache_key',
  ]) {
    if (hasTable(db, table)) {
      db.exec(`DELETE FROM "${table}"`);
    }
  }
  for (const table of TOMBSTONED_TABLES) {
    db.exec(`DELETE FROM "${table}" WHERE tombstone = 1`);
  }
}

function printReport(report) {
  const { accounts, transfers, fixedTransfers, schedules, removed } = report;
  console.log(`\nMain currency: ${report.mainCurrency || '(none)'}`);
  console.log(`Transactions converted: ${report.converted}`);

  if (accounts.length > 0) {
    console.log('\nAccounts:');
    for (const a of accounts) {
      console.log(
        `  ${a.name}: ${money(a.nativeBalance)} ${a.currency} -> ` +
          `${money(a.converted)} ${report.mainCurrency} at each date's rate, ` +
          `${money(a.adjustment)} adjustment, ${money(a.final)} final`,
      );
    }
  }

  const uncategorized = accounts.filter(
    a => a.adjustment !== 0 && !a.offbudget,
  );
  if (uncategorized.length > 0) {
    console.log(
      `\nCategorize the adjustment in these on-budget accounts: ` +
        uncategorized.map(a => a.name).join(', '),
    );
  }

  if (transfers.length > 0) {
    console.log(
      `\nTransfers whose sides don't match after converting` +
        `${fixedTransfers ? ' (fixed)' : ' (left as they are, use --fix-transfers)'}:`,
    );
    for (const t of transfers) {
      console.log(
        `  ${t.date}: ${t.aName} ${money(t.aAmount)}, ` +
          `${t.bName} ${money(t.bAmount)}`,
      );
    }
  }

  console.log(
    `\nSchedules converted at the latest rate: ${schedules.converted}`,
  );
  if (schedules.unconverted.length > 0) {
    console.log(
      `Schedules not converted, no rate: ${schedules.unconverted.join(', ')}`,
    );
  }

  const linked = accounts.filter(a => a.account_id);
  if (linked.length > 0) {
    console.log(
      `\nThese accounts are linked to a bank and will sync new transactions ` +
        `in ${linked.map(a => a.currency).join(', ')} as if they were ` +
        `${report.mainCurrency}. Unlink them: ` +
        linked.map(a => a.name).join(', '),
    );
  }

  const removedTables = Object.entries(removed);
  if (removedTables.length > 0) {
    console.log('\nRemoved:');
    for (const [table, count] of removedTables) {
      console.log(`  ${table}: ${count} rows`);
    }
  }
}

function port(db, { fixTransfers: shouldFixTransfers }) {
  if (!hasColumn(db, 'accounts', 'currency')) {
    throw new PortError('This budget has no multi-currency data to port.');
  }
  if (hasTable(db, 'securities')) {
    throw new PortError(
      'This budget has investment data, which this script does not port.',
    );
  }
  const mainCurrency = db
    .prepare(`SELECT value FROM preferences WHERE id = 'defaultCurrencyCode'`)
    .get()?.value;
  const foreignAccounts = getForeignAccounts(db, mainCurrency);
  const accountIds = foreignAccounts.map(a => a.id);

  const missing = getMissingConversions(db, accountIds);
  const noRate = foreignAccounts.filter(
    a => a.rate == null && a.nativeBalance !== 0,
  );
  if (missing.length > 0 || noRate.length > 0) {
    const lines = [
      ...noRate.map(
        a => `  ${a.name}: no ${a.currency} to ${mainCurrency} exchange rate`,
      ),
      ...missing.map(
        t => `  ${t.date} ${t.account}: ${money(t.amount)} has no rate`,
      ),
    ];
    throw new PortError(
      `Add these exchange rates on the branch and export again:\n${lines.join('\n')}`,
    );
  }

  const report = db.transaction(() => {
    const converted = convertTransactions(db, accountIds);
    const transfers = findBrokenTransfers(db, accountIds);
    if (shouldFixTransfers) {
      fixTransfers(db, transfers, accountIds);
    }
    updateSplitParents(db, accountIds);
    const schedules = convertSchedules(db, foreignAccounts);
    const accounts = addBalanceAdjustments(db, foreignAccounts);
    const removed = removeBranchSchema(db);
    clearSyncHistory(db);
    return {
      mainCurrency,
      converted,
      transfers,
      fixedTransfers: shouldFixTransfers,
      schedules,
      accounts,
      removed,
    };
  })();

  db.exec('ANALYZE; VACUUM;');
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new PortError(`The result failed its integrity check: ${integrity}`);
  }
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter(arg => arg.startsWith('--'));
  const paths = args.filter(arg => !arg.startsWith('--'));
  const unknownFlags = flags.filter(
    flag => flag !== '--dry-run' && flag !== '--fix-transfers',
  );
  if (paths.length !== 2 || unknownFlags.length > 0) {
    throw new PortError(
      'Usage: node packages/loot-core/bin/port-budget-to-mainline.mjs <export.zip> <output.zip> [--dry-run] [--fix-transfers]',
    );
  }
  const [input, output] = paths;
  const isDryRun = flags.includes('--dry-run');
  if (!isDryRun && existsSync(output)) {
    throw new PortError(`${output} already exists, refusing to overwrite it.`);
  }

  const { db: dbContent, meta } = readArchive(input);
  const workDir = mkdtempSync(join(tmpdir(), 'port-budget-'));
  try {
    const dbPath = join(workDir, 'db.sqlite');
    writeFileSync(dbPath, dbContent);
    const db = new Database(dbPath);
    let report;
    try {
      report = port(db, { fixTransfers: flags.includes('--fix-transfers') });
    } finally {
      db.close();
    }
    printReport(report);

    if (isDryRun) {
      console.log('\nDry run: nothing was written.');
      return;
    }
    const newMeta = {
      ...meta,
      budgetName: `${meta.budgetName} (mainline)`,
      cloudFileId: null,
      groupId: null,
      encryptKeyId: null,
      lastUploaded: null,
      lastSyncedTimestamp: null,
      resetClock: true,
    };
    writeFileSync(
      output,
      zipSync({
        'db.sqlite': readFileSync(dbPath),
        'metadata.json': Buffer.from(JSON.stringify(newMeta), 'utf8'),
      }),
    );
    console.log(`\nWrote ${output}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (!(error instanceof PortError)) {
    throw error;
  }
  console.error(error.message);
  process.exitCode = 1;
}
