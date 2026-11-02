import { integerToCurrency } from '@actual-app/core/shared/util';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useFormat } from './useFormat';
import {
  getForeignCurrency,
  useHasForeignAccounts,
  useMainCurrency,
} from './useMainCurrency';

/**
 * Formats an amount of the account, or of the main currency without an account.
 * Once a budget has accounts in other currencies, a plain number could be in
 * any of them, so amounts show their currency symbol.
 */
export function useAccountAmountFormat(
  account?: Pick<AccountEntity, 'currency'> | null,
): (value: IntegerAmount) => string {
  const format = useFormat();
  const mainCurrency = useMainCurrency();
  const hasForeignAccounts = useHasForeignAccounts();

  return value =>
    hasForeignAccounts
      ? format(
          value,
          'financial',
          getForeignCurrency(account, mainCurrency) ?? undefined,
        )
      : integerToCurrency(value);
}
