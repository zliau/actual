import type { CSSProperties } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgExclamationOutline } from '@actual-app/components/icons/v1';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useMainCurrency } from '#hooks/useMainCurrency';
import { useMissingExchangeRates } from '#hooks/useMissingExchangeRates';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type MissingExchangeRatesProps = {
  style?: CSSProperties;
  textStyle?: CSSProperties;
};

// Says which currencies are left out of totals because they have no exchange
// rate, and lets the user add one
export function MissingExchangeRates({
  style,
  textStyle,
}: MissingExchangeRatesProps) {
  const dispatch = useDispatch();
  const mainCurrency = useMainCurrency();
  const currencies = useMissingExchangeRates();

  if (mainCurrency == null || currencies.length === 0) {
    return null;
  }

  return (
    <View style={style}>
      {currencies.map(currency => (
        <Button
          key={currency}
          variant="bare"
          onPress={() =>
            dispatch(
              pushModal({
                modal: {
                  name: 'edit-exchange-rate',
                  options: { fromCurrency: currency, toCurrency: mainCurrency },
                },
              }),
            )
          }
          style={{
            justifyContent: 'flex-start',
            alignItems: 'flex-start',
            textAlign: 'left',
            gap: 6,
            padding: '6px 8px',
          }}
        >
          <SvgExclamationOutline
            style={{
              width: 12,
              height: 12,
              flexShrink: 0,
              marginTop: 2,
              color: theme.warningText,
            }}
          />
          <Text style={{ lineHeight: 1.4, ...textStyle }}>
            <Trans>
              {{ currency }} amounts are not in totals. Add a {{ currency }} to{' '}
              {{ mainCurrency }} rate.
            </Trans>
          </Text>
        </Button>
      ))}
    </View>
  );
}
