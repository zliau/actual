import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import type {
  SecurityEntity,
  SecuritySplitEntity,
} from '@actual-app/core/types/models';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { DateSelect } from '#components/select/DateSelect';
import { parseExchangeRate } from '#exchange-rates';
import { useDateFormat } from '#hooks/useDateFormat';
import {
  formatShares,
  useDeleteSecuritySplitMutation,
  useSetSecuritySplitMutation,
} from '#investments';

import { TradeNumberField as NumberField } from './TradeNumberField';

type EditSecuritySplitModalProps = {
  security: SecurityEntity['id'];
  symbol: string;
  split?: SecuritySplitEntity;
};

export function EditSecuritySplitModal({
  security,
  symbol,
  split,
}: EditSecuritySplitModalProps) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const setSplit = useSetSecuritySplitMutation();
  const deleteSplit = useDeleteSecuritySplitMutation();

  const [date, setDate] = useState(split?.date ?? currentDay());
  const [newSharesText, setNewSharesText] = useState(
    split && split.ratio >= 1 ? formatShares(split.ratio) : split ? '1' : '',
  );
  const [oldSharesText, setOldSharesText] = useState(
    split && split.ratio < 1
      ? formatShares(Number((1 / split.ratio).toFixed(6)))
      : '1',
  );
  const [error, setError] = useState<string | null>(null);

  const blockedMessage = t(
    'With this split, some later {{symbol}} sells would be for more shares than you hold. Check those sells first.',
    { symbol },
  );

  const onSubmit = async (
    event: FormEvent<HTMLFormElement>,
    close: () => void,
  ) => {
    event.preventDefault();

    const newShares = parseExchangeRate(newSharesText);
    const oldShares = parseExchangeRate(oldSharesText);
    if (newShares == null || oldShares == null || newShares === oldShares) {
      setError(t('Enter both numbers, like 4 new shares for 1 old share.'));
      return;
    }

    // A split is stored per day, so moving it to another day replaces the old
    // one
    const result = await setSplit.mutateAsync({
      security,
      date,
      ratio: newShares / oldShares,
    });
    if ('error' in result) {
      setError(blockedMessage);
      return;
    }
    if (split && split.date !== date) {
      await deleteSplit.mutateAsync({ id: split.id });
    }
    close();
  };

  const onDelete = async (close: () => void) => {
    if (!split) {
      return;
    }
    const result = await deleteSplit.mutateAsync({ id: split.id });
    if ('error' in result) {
      setError(blockedMessage);
      return;
    }
    close();
  };

  return (
    <Modal
      name="edit-security-split"
      containerProps={{ style: { width: 400 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={
                  split
                    ? t('Edit {{symbol}} split', { symbol })
                    : t('Add {{symbol}} split', { symbol })
                }
                shrinkOnOverflow
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Form onSubmit={event => void onSubmit(event, () => state.close())}>
            <InlineField label={t('Date')} width="100%">
              <View style={{ flex: 1 }}>
                <DateSelect
                  value={date}
                  dateFormat={dateFormat}
                  onSelect={setDate}
                  onUpdate={setDate}
                />
              </View>
            </InlineField>
            <NumberField
              label={t('New shares')}
              name="new-shares"
              value={newSharesText}
              onChange={value => {
                setNewSharesText(value);
                setError(null);
              }}
            />
            <NumberField
              label={t('Old shares')}
              name="old-shares"
              value={oldSharesText}
              onChange={value => {
                setOldSharesText(value);
                setError(null);
              }}
            />
            {error && <FormError style={{ marginTop: 5 }}>{error}</FormError>}
            <Text
              style={{
                color: theme.pageTextLight,
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              <Trans>
                In a 4-for-1 split, each old share becomes 4 new ones. The split
                applies to every account that holds {{ symbol }}, starting on
                this date.
              </Trans>
            </Text>

            <ModalButtons
              leftContent={
                split && (
                  <Button
                    style={{ color: theme.errorText }}
                    onPress={() => void onDelete(() => state.close())}
                  >
                    <Trans>Delete</Trans>
                  </Button>
                )
              }
            >
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                variant="primary"
                style={{ marginLeft: 10 }}
              >
                <Trans>Save</Trans>
              </Button>
            </ModalButtons>
          </Form>
        </>
      )}
    </Modal>
  );
}
