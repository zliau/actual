import { useEffect } from 'react';

import { useAccounts } from '#hooks/useAccounts';
import { useUpdateSecurityPricesMutation } from '#investments';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Keeps investment accounts up to date: when the budget opens, and regularly
 * for a budget that stays open. Without a server this still rolls their value
 * over into a new month.
 */
export function useAutomaticSecurityPrices() {
  const { data: accounts = [] } = useAccounts();
  const { mutate: updatePrices } = useUpdateSecurityPricesMutation();

  const hasInvestments = accounts.some(
    account => account.investment === 1 && account.closed === 0,
  );

  useEffect(() => {
    if (!hasInvestments) {
      return;
    }

    updatePrices();
    const interval = setInterval(updatePrices, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasInvestments, updatePrices]);
}
