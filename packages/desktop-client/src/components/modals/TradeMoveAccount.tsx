import { Trans, useTranslation } from 'react-i18next';

import { InlineField } from '@actual-app/components/inline-field';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { TradeEntity } from '@actual-app/core/types/models';

import { useAccounts } from '#hooks/useAccounts';

type TradeMoveAccountProps = {
  account: TradeEntity['account'];
  currency: string;
  // A stored move shows where its shares went or came from
  trade?: TradeEntity;
  value: string;
  onChange: (account: string) => void;
};

// The account a move's shares go to: another open investment account in the
// same currency
export function TradeMoveAccount({
  account,
  currency,
  trade,
  value,
  onChange,
}: TradeMoveAccountProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();

  if (trade) {
    const other =
      accounts.find(({ id }) => id === trade.transfer_account)?.name ??
      t('a deleted account');
    return (
      <Text style={{ color: theme.pageTextLight, marginBottom: 5 }}>
        {trade.type === 'move-out' ? (
          <Trans>Moved to {{ account: other }}</Trans>
        ) : (
          <Trans>Moved from {{ account: other }}</Trans>
        )}
      </Text>
    );
  }

  // Compared as stored, like the server does
  const accountCurrency =
    accounts.find(({ id }) => id === account)?.currency ?? currency;
  const options = accounts.filter(
    other =>
      other.investment &&
      !other.closed &&
      other.id !== account &&
      other.currency === accountCurrency,
  );
  if (options.length === 0) {
    return (
      <Text style={{ color: theme.pageTextLight, marginBottom: 5 }}>
        <Trans>
          To move shares, first create another investment account in{' '}
          {{ currency }}.
        </Trans>
      </Text>
    );
  }
  return (
    <InlineField label={t('To')} width="100%">
      <Select
        aria-label={t('To account')}
        value={value}
        onChange={onChange}
        options={[
          ['', t('Choose an account')],
          ...options.map(({ id, name }) => [id, name] as [string, string]),
        ]}
        style={{ flex: 1 }}
      />
    </InlineField>
  );
}
