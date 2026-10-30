import {
  isPreviewId,
  isTemporaryId,
} from '@actual-app/core/shared/transactions';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { getForeignCurrency, useMainCurrency } from './useMainCurrency';
import { useRatesToMainCurrency } from './useRatesToMainCurrency';

type ConvertedAmount = {
  // Set when the account is in another currency than the main one
  currency: string | null;
  mainCurrency: string | null;
  // The amount in the main currency, when it's known
  value: number | null;
  // Whether the transaction is saved but no exchange rate is known for it
  isMissingRate: boolean;
};

type ConvertibleTransaction = Pick<
  TransactionEntity,
  'id' | 'date' | 'amount' | 'converted_amount'
>;

/**
 * The amount of a transaction in the main currency. Saved transactions were
 * converted with the exchange rate of their date, scheduled ones are estimated
 * until they're saved, and unsaved ones have no conversion yet.
 */
export function getConvertedAmount({
  transaction,
  currency,
  mainCurrency,
  getRate,
}: {
  transaction: ConvertibleTransaction;
  currency: string | null;
  mainCurrency: string | null;
  getRate: (currency: string | null, date: string) => number;
}): Pick<ConvertedAmount, 'value' | 'isMissingRate'> {
  if (isPreviewId(transaction.id)) {
    const rate = getRate(currency, transaction.date);
    return {
      value: rate > 0 ? Math.round((transaction.amount ?? 0) * rate) : null,
      isMissingRate: false,
    };
  }
  if (isTemporaryId(transaction.id)) {
    return { value: null, isMissingRate: false };
  }
  if (currency == null) {
    return { value: transaction.amount, isMissingRate: false };
  }
  const value = transaction.converted_amount ?? null;
  return { value, isMissingRate: value == null && mainCurrency != null };
}

export function useConvertedAmount(
  transaction: ConvertibleTransaction | undefined,
  account: Pick<AccountEntity, 'currency'> | null | undefined,
): ConvertedAmount {
  const mainCurrency = useMainCurrency();
  const getRate = useRatesToMainCurrency();
  const currency = getForeignCurrency(account, mainCurrency);

  return {
    currency,
    mainCurrency,
    ...(transaction
      ? getConvertedAmount({ transaction, currency, mainCurrency, getRate })
      : { value: null, isMissingRate: false }),
  };
}
