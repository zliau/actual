import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { SecurityCloseResult } from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';

import { FinancialText } from '#components/FinancialText';
import { useDateFormat } from '#hooks/useDateFormat';
import { formatSharePrice, getSecurityProviderMessage } from '#investments';

type TradeCloseHintProps = {
  currency: string;
  result: SecurityCloseResult | undefined;
  isLoading: boolean;
};

// Says where a trade's suggested price came from, or why there isn't one
export function TradeCloseHint({
  currency,
  result,
  isLoading,
}: TradeCloseHintProps) {
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  let content;
  if (isLoading) {
    content = <Trans>Looking up the close…</Trans>;
  } else if (!result) {
    return null;
  } else if ('close' in result) {
    const date = formatDate(parseISO(result.date), dateFormat);
    content = (
      <>
        <Trans>Close on {{ date }}:</Trans>{' '}
        <FinancialText>
          {formatSharePrice(result.close)} {currency}
        </FinancialText>
      </>
    );
  } else if (
    // Without a server, prices are always typed in, so there's nothing to say
    result.error === 'no-server' ||
    result.error === 'unauthorized'
  ) {
    return null;
  } else if (result.error === 'no-close') {
    content = <Trans>No close found for this date.</Trans>;
  } else {
    content = getSecurityProviderMessage(result.error);
  }

  return (
    <Text
      style={{
        marginLeft: 75,
        marginBottom: 5,
        fontSize: 13,
        color: theme.pageTextLight,
      }}
    >
      {content}
    </Text>
  );
}
