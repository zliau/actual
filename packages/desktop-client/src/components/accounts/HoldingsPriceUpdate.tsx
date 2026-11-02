import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { getCurrencyExchange } from '@actual-app/core/shared/investments';
import { useQuery } from '@tanstack/react-query';

import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import {
  getSecurityProviderMessage,
  investmentQueries,
  useUpdateSecurityPricesMutation,
} from '#investments';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type HoldingsPriceUpdateProps = {
  currency: string;
};

// Prices need a server and a key, so without those there is nothing to show:
// prices can still be entered by hand
export function HoldingsPriceUpdate({ currency }: HoldingsPriceUpdateProps) {
  const dispatch = useDispatch();
  const isOnline = useSyncServerStatus() === 'online';
  const exchange = getCurrencyExchange(currency);
  const { data: status } = useQuery({
    ...investmentQueries.priceStatus(),
    enabled: isOnline,
  });
  const updatePrices = useUpdateSecurityPricesMutation();
  const result = updatePrices.data;

  if (!isOnline || !exchange || !status || 'error' in status) {
    return null;
  }

  const onSetUp = () =>
    dispatch(
      pushModal({ modal: { name: 'security-price-setup', options: {} } }),
    );

  if (!status[exchange]) {
    return (
      <Button variant="bare" onPress={onSetUp}>
        <Trans>Set up price updates</Trans>
      </Button>
    );
  }

  const problem =
    result && 'problems' in result ? result.problems[exchange] : undefined;
  const unavailable =
    result && 'unavailable' in result ? result.unavailable.join(', ') : '';

  return (
    <>
      {updatePrices.isError ||
      problem ||
      (result && 'error' in result) ||
      unavailable ? (
        <Text style={{ color: theme.errorText, fontSize: 13 }}>
          {problem || updatePrices.isError || (result && 'error' in result) ? (
            getSecurityProviderMessage(problem ?? '')
          ) : (
            <Trans>No prices found for {{ symbols: unavailable }}.</Trans>
          )}
        </Text>
      ) : (
        result &&
        'count' in result && (
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            {result.count === 0 ? (
              <Trans>Prices are up to date.</Trans>
            ) : (
              <Trans count={result.count}>
                Fetched {{ count: result.count }} prices.
              </Trans>
            )}
          </Text>
        )
      )}
      {problem === 'invalid-key' && (
        <Button variant="bare" onPress={onSetUp}>
          <Trans>Set up price updates</Trans>
        </Button>
      )}
      <Button
        isDisabled={updatePrices.isPending}
        onPress={() => updatePrices.mutate()}
      >
        {updatePrices.isPending ? (
          <AnimatedLoading style={{ width: 16, height: 16 }} />
        ) : (
          <Trans>Update prices</Trans>
        )}
      </Button>
    </>
  );
}
