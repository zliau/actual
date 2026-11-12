import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { TradeType } from '@actual-app/core/types/models';

type TradeTypeHintProps = {
  type: TradeType;
};

// What a kind of trade is for, for those that aren't plain buys and sells
export function TradeTypeHint({ type }: TradeTypeHintProps) {
  const hint = getHint(type);
  if (!hint) {
    return null;
  }
  return (
    <Text style={{ color: theme.pageTextLight, fontSize: 13, marginBottom: 5 }}>
      {hint}
    </Text>
  );
}

function getHint(type: TradeType) {
  switch (type) {
    case 'vest':
      return (
        <Trans>
          Shares you received as pay, such as RSUs. They are added at their
          price on the vest date, and no cash leaves the account.
        </Trans>
      );
    case 'dividend':
      return (
        <Trans>
          Cash a stock paid you. It counts toward that stock's return.
        </Trans>
      );
    case 'reinvested-dividend':
      return (
        <Trans>
          A dividend that bought more shares instead of paying cash. Enter the
          shares it bought and their price. They cost what the dividend paid,
          and no cash moves.
        </Trans>
      );
    case 'return-of-capital':
      return (
        <Trans>
          Cash a fund paid back from what you put in, as shown on your tax slip
          or statement. It lowers what your shares cost. Once that reaches zero,
          the rest counts as a realized gain.
        </Trans>
      );
    case 'move-in':
    case 'move-out':
      return (
        <Trans>
          Shares moving to another of your accounts, such as from an employer's
          plan to your own brokerage. They keep what you paid for them, and no
          cash moves.
        </Trans>
      );
    default:
      return null;
  }
}
