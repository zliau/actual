import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { DividendSuggestion } from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';

import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import {
  formatSharePrice,
  formatShares,
  useDismissDividendMutation,
} from '#investments';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type HoldingsDividendSuggestionProps = {
  dividend: DividendSuggestion;
  currency: string;
};

// A dividend a provider reported for shares the account held. Recording it
// opens the trade form filled in, so the date and, for reinvested shares, the
// shares bought can be checked against the broker first.
export function HoldingsDividendSuggestion({
  dividend,
  currency,
}: HoldingsDividendSuggestionProps) {
  const dispatch = useDispatch();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const dismissDividend = useDismissDividendMutation();

  const symbol = dividend.symbol;
  const date = formatDate(parseISO(dividend.date), dateFormat);
  const perShare = formatSharePrice(dividend.perShare);
  const shares = formatShares(dividend.shares);
  const amount = format(dividend.amount, 'financial', currency);

  const onRecord = (type: 'dividend' | 'reinvested-dividend') =>
    dispatch(
      pushModal({
        modal: {
          name: 'edit-trade',
          options: {
            account: dividend.account,
            currency,
            symbol,
            dividend,
            type,
          },
        },
      }),
    );

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        color: theme.noticeTextDark,
        backgroundColor: theme.noticeBackground,
      }}
    >
      <Text style={{ flex: 1, minWidth: 200 }}>
        <Trans>
          {{ symbol }} paid a dividend of {{ perShare }} a share, ex-dividend on{' '}
          {{ date }}. For your {{ shares }} shares, that is {{ amount }} before
          tax.
        </Trans>
      </Text>
      <Button onPress={() => dismissDividend.mutate({ id: dividend.id })}>
        <Trans>Ignore</Trans>
      </Button>
      <Button
        variant={dividend.wasLastReinvested ? 'primary' : 'normal'}
        onPress={() => onRecord('reinvested-dividend')}
      >
        <Trans>Record reinvested</Trans>
      </Button>
      <Button
        variant={dividend.wasLastReinvested ? 'normal' : 'primary'}
        onPress={() => onRecord('dividend')}
      >
        <Trans>Record as cash</Trans>
      </Button>
    </View>
  );
}
