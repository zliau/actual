import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import type {
  SecurityEntity,
  SecurityPriceEntity,
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
  formatSharePrice,
  useDeleteSecurityPriceMutation,
  useSetSecurityPriceMutation,
} from '#investments';

type EditSecurityPriceModalProps = {
  security: SecurityEntity['id'];
  symbol: string;
  currency: string;
  price?: SecurityPriceEntity;
};

export function EditSecurityPriceModal({
  security,
  symbol,
  currency,
  price,
}: EditSecurityPriceModalProps) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const setSecurityPrice = useSetSecurityPriceMutation();
  const deleteSecurityPrice = useDeleteSecurityPriceMutation();

  const [date, setDate] = useState(price?.date ?? currentDay());
  const [closeText, setCloseText] = useState(
    price ? formatSharePrice(price.close) : '',
  );
  const [hasCloseError, setHasCloseError] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();

    const closePrice = parseExchangeRate(closeText);
    if (closePrice == null) {
      setHasCloseError(true);
      return;
    }

    // A price is stored per day, so moving it to another day replaces the old
    // one
    if (price && price.date !== date) {
      deleteSecurityPrice.mutate({ id: price.id });
    }
    setSecurityPrice.mutate({ security, date, close: closePrice });
    close();
  };

  return (
    <Modal
      name="edit-security-price"
      containerProps={{ style: { width: 400 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={
                  price
                    ? t('Edit {{symbol}} price', { symbol })
                    : t('Add {{symbol}} price', { symbol })
                }
                shrinkOnOverflow
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Form onSubmit={event => onSubmit(event, () => state.close())}>
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
            <InlineField label={t('Close')} width="100%">
              <View
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
              >
                <InitialFocus>
                  <Input
                    name="close"
                    inputMode="decimal"
                    aria-label={t('Close')}
                    value={closeText}
                    onChangeValue={value => {
                      setCloseText(value);
                      setHasCloseError(false);
                    }}
                    style={{ flex: 1, textAlign: 'right', ...styles.tnum }}
                  />
                </InitialFocus>
                <Text style={{ marginLeft: 8 }}>{currency}</Text>
              </View>
            </InlineField>
            {hasCloseError && (
              <FormError style={{ marginLeft: 75 }}>
                <Trans>Price must be more than zero.</Trans>
              </FormError>
            )}
            <Text
              style={{
                color: theme.pageTextLight,
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              <Trans>
                Holdings use the latest close, or the price of your latest trade
                if that's more recent.
              </Trans>
            </Text>

            <ModalButtons
              leftContent={
                price && (
                  <Button
                    style={{ color: theme.errorText }}
                    onPress={() => {
                      deleteSecurityPrice.mutate({ id: price.id });
                      state.close();
                    }}
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
