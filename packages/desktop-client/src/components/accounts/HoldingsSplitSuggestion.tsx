import { useState } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountHoldings } from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';

import { useDateFormat } from '#hooks/useDateFormat';
import {
  formatSplitRatio,
  useDismissSecuritySplitMutation,
  useSetSecuritySplitMutation,
} from '#investments';

type HoldingsSplitSuggestionProps = {
  split: AccountHoldings['suggestedSplits'][number];
};

// Until a reported split is answered, the shares and the prices since it don't
// match, so the holding's value is wrong. This has to be hard to miss.
export function HoldingsSplitSuggestion({
  split,
}: HoldingsSplitSuggestionProps) {
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const setSplit = useSetSecuritySplitMutation();
  const dismissSplit = useDismissSecuritySplitMutation();
  const [isBlocked, setIsBlocked] = useState(false);

  const symbol = split.symbol;
  const ratio = formatSplitRatio(split.ratio);
  const date = formatDate(parseISO(split.date), dateFormat);

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        color: theme.warningTextDark,
        backgroundColor: theme.warningBackground,
      }}
    >
      <Text style={{ flex: 1, minWidth: 200 }}>
        {isBlocked ? (
          <Trans>
            With this {{ ratio }} split, some later {{ symbol }} sells would be
            for more shares than you hold. Check those sells first.
          </Trans>
        ) : (
          <Trans>
            {{ symbol }} may have split {{ ratio }} on {{ date }}. Its value may
            be wrong until you apply or ignore the split. Apply it if your
            broker shows it.
          </Trans>
        )}
      </Text>
      <Button onPress={() => dismissSplit.mutate({ id: split.id })}>
        <Trans>Ignore</Trans>
      </Button>
      <Button
        variant="primary"
        onPress={() =>
          setSplit.mutate(
            {
              security: split.security,
              date: split.date,
              ratio: split.ratio,
            },
            { onSuccess: result => setIsBlocked('error' in result) },
          )
        }
      >
        <Trans>Apply split</Trans>
      </Button>
    </View>
  );
}
