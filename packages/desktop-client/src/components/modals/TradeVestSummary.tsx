import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { formatShares } from '#investments';

type TradeVestSummaryProps = {
  received: number;
  // In cents
  pay: number;
  tax: number;
  currency: string;
};

// What a vest adds to the account, and the pay and tax it stands for
export function TradeVestSummary({
  received,
  pay,
  tax,
  currency,
}: TradeVestSummaryProps) {
  const format = useFormat();
  return (
    <View style={{ color: theme.pageTextLight, marginTop: 10, gap: 3 }}>
      <Text>
        <Trans>Shares received</Trans>{' '}
        <FinancialText style={{ fontWeight: 600 }}>
          {formatShares(received)}
        </FinancialText>
      </Text>
      <Text>
        <Trans>Pay</Trans>{' '}
        <FinancialText>{format(pay, 'financial', currency)}</FinancialText>
      </Text>
      {tax > 0 && (
        <Text>
          <Trans>Withheld for tax</Trans>{' '}
          <FinancialText>{format(tax, 'financial', currency)}</FinancialText>
        </Text>
      )}
    </View>
  );
}
