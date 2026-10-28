// @ts-strict-ignore
import * as db from '#server/db';

import { runRules } from './transaction-rules';

async function getPayee(acct) {
  return db.first<db.DbPayee>('SELECT * FROM payees WHERE transfer_acct = ?', [
    acct,
  ]);
}

async function getTransferredAccount(transaction) {
  if (transaction.payee) {
    const result = await db.first<Pick<db.DbViewPayee, 'transfer_acct'>>(
      'SELECT transfer_acct FROM v_payees WHERE id = ?',
      [transaction.payee],
    );

    return result?.transfer_acct || null;
  }
  return null;
}

async function clearCategory(transaction, transferAcct) {
  const { offbudget: fromOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transaction.account]);
  const { offbudget: toOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transferAcct]);

  // If the transfer is between two on budget or two off budget accounts,
  // we should clear the category, because the category is not relevant
  if (fromOffBudget === toOffBudget) {
    await db.updateTransaction({ id: transaction.id, category: null });
    if (transaction.transfer_id) {
      await db.updateTransaction({
        id: transaction.transfer_id,
        category: null,
      });
    }
    return true;
  }
  return false;
}

// The currencies of two accounts when they differ, otherwise null. Each side
// of a transfer between them keeps its own amount, in its own currency.
async function getTransferCurrencies(
  fromAccount: string,
  toAccount: string,
): Promise<{ from: string; to: string } | null> {
  const mainCurrency = await db.getMainCurrency();
  if (!mainCurrency) {
    return null;
  }

  const rows = await db.all<Pick<db.DbAccount, 'id' | 'currency'>>(
    'SELECT id, currency FROM accounts WHERE id IN (?, ?)',
    [fromAccount, toAccount],
  );
  const currencyOf = (id: string) =>
    rows.find(row => row.id === id)?.currency ?? mainCurrency;
  const from = currencyOf(fromAccount);
  const to = currencyOf(toAccount);
  return from === to ? null : { from, to };
}

// What the other side of a transfer between currencies likely received, at
// the exchange rate of its date. The user can correct it with the amount
// that actually arrived.
async function estimateTransferAmount(
  amount: number,
  { from, to }: { from: string; to: string },
  date: string,
): Promise<number> {
  let rate = await db.getExchangeRate(from, to, date);
  if (rate == null) {
    // Go through the main currency, which the stored rates are against
    const mainCurrency = await db.getMainCurrency();
    const fromRate = await db.getExchangeRate(from, mainCurrency, date);
    const toRate = await db.getExchangeRate(to, mainCurrency, date);
    if (fromRate != null && toRate != null) {
      rate = fromRate / toRate;
    }
  }
  return rate == null ? -amount : -Math.round(amount * rate);
}

// The amount of the other side of a transfer after this side changed. In the
// same currency it mirrors this side. Between currencies it keeps the amount
// the user entered there, only flipping it to keep money flowing one way.
async function getTransferAmount(transaction, transferredAccount) {
  const currencies = await getTransferCurrencies(
    transaction.account,
    transferredAccount,
  );
  if (!currencies) {
    return -transaction.amount;
  }

  const other = await db.getTransaction(transaction.transfer_id);
  if (!other || other.account !== transferredAccount || other.amount === 0) {
    return estimateTransferAmount(
      transaction.amount,
      currencies,
      transaction.date,
    );
  }
  if (Math.sign(other.amount) === Math.sign(transaction.amount)) {
    return -other.amount;
  }
  return other.amount;
}

export async function addTransfer(transaction, transferredAccount) {
  if (transaction.is_parent) {
    // For split transactions, we should create transfers using child transactions.
    // This is to ensure that the amounts received by the transferred account
    // reflects the amounts in the child transactions and not the parent transaction
    // amount which is the total amount.
    return null;
  }

  const { id: fromPayee } = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [transaction.account],
  );

  const currencies = await getTransferCurrencies(
    transaction.account,
    transferredAccount,
  );
  const transferTransaction = {
    account: transferredAccount,
    amount: currencies
      ? await estimateTransferAmount(
          transaction.amount,
          currencies,
          transaction.date,
        )
      : -transaction.amount,
    payee: fromPayee,
    date: transaction.date,
    transfer_id: transaction.id,
    notes: transaction.notes || null,
    schedule: transaction.schedule,
    cleared: false,
  };
  const { notes, cleared, schedule } = await runRules(transferTransaction);
  const matchedSchedule = schedule ?? transaction.schedule;

  const id = await db.insertTransaction({
    ...transferTransaction,
    notes,
    cleared,
    schedule: matchedSchedule,
  });

  await db.updateTransaction({
    id: transaction.id,
    transfer_id: id,
    ...(matchedSchedule ? { schedule: matchedSchedule } : {}),
  });
  const categoryCleared = await clearCategory(transaction, transferredAccount);

  return {
    id: transaction.id,
    transfer_id: id,
    ...(categoryCleared ? { category: null } : {}),
  };
}

export async function removeTransfer(transaction) {
  const transferTrans = await db.getTransaction(transaction.transfer_id);

  // Perform operations on the transfer transaction only
  // if it is found. For example: when users delete both
  // (in & out) transfer transactions at the same time -
  // transfer transaction will not be found.
  if (transferTrans) {
    if (transferTrans.is_child) {
      // If it's a child transaction, we don't delete it because that
      // would invalidate the whole split transaction. Instead of turn
      // it into a normal transaction
      await db.updateTransaction({
        id: transaction.transfer_id,
        transfer_id: null,
        payee: null,
      });
    } else {
      await db.deleteTransaction({ id: transaction.transfer_id });
    }
  }
  await db.updateTransaction({ id: transaction.id, transfer_id: null });
  return { id: transaction.id, transfer_id: null };
}

export async function updateTransfer(transaction, transferredAccount) {
  const payee = await getPayee(transaction.account);

  await db.updateTransaction({
    id: transaction.transfer_id,
    account: transferredAccount,
    // Make sure to update the payee on the other side in case the
    // user moved this transaction into another account
    payee: payee.id,
    notes: transaction.notes,
    amount: await getTransferAmount(transaction, transferredAccount),
    schedule: transaction.schedule,
  });
  // The conversion of this side can depend on the amount of the other
  await db.refreshConvertedAmount(transaction.id);

  const categoryCleared = await clearCategory(transaction, transferredAccount);
  if (categoryCleared) {
    return { id: transaction.id, category: null };
  }
}

export async function onInsert(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transferredAccount) {
    return addTransfer(transaction, transferredAccount);
  }
}

export async function onDelete(transaction) {
  if (transaction.transfer_id) {
    await removeTransfer(transaction);
  }
}

export async function onUpdate(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transaction.is_parent) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && !transaction.transfer_id) {
    return addTransfer(transaction, transferredAccount);
  }

  if (!transferredAccount && transaction.transfer_id) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && transaction.transfer_id) {
    return updateTransfer(transaction, transferredAccount);
  }
}
