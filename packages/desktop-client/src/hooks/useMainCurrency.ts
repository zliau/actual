import type { AccountEntity } from '@actual-app/core/types/models';

import { useAccounts } from './useAccounts';
import { useFeatureFlag } from './useFeatureFlag';
import { useSyncedPref } from './useSyncedPref';

/**
 * The budget's main currency, or null when accounts can't have their own
 * currency (the currency feature is off or no main currency is set).
 */
export function useMainCurrency(): string | null {
  const isEnabled = useFeatureFlag('currency');
  const [defaultCurrencyCode] = useSyncedPref('defaultCurrencyCode');
  return isEnabled && defaultCurrencyCode ? defaultCurrencyCode : null;
}

/**
 * Whether any account is in another currency than the main one.
 */
export function useHasForeignAccounts(): boolean {
  const mainCurrency = useMainCurrency();
  const { data: accounts = [] } = useAccounts();
  return accounts.some(
    account => getForeignCurrency(account, mainCurrency) != null,
  );
}

/**
 * Whether a transfer between these accounts has a different amount on each
 * side, because they use different currencies.
 */
export function isCrossCurrencyTransfer(
  account: Pick<AccountEntity, 'currency'> | null | undefined,
  transferAccount: Pick<AccountEntity, 'currency'> | null | undefined,
  mainCurrency: string | null,
): boolean {
  return (
    mainCurrency != null &&
    account != null &&
    transferAccount != null &&
    (account.currency ?? mainCurrency) !==
      (transferAccount.currency ?? mainCurrency)
  );
}

/**
 * The account's currency when it differs from the main currency, otherwise
 * null.
 */
export function getForeignCurrency(
  account: Pick<AccountEntity, 'currency'> | null | undefined,
  mainCurrency: string | null,
): string | null {
  if (
    mainCurrency == null ||
    account?.currency == null ||
    account.currency === mainCurrency
  ) {
    return null;
  }
  return account.currency;
}
