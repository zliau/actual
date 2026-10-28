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
import type { ExchangeRateEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { DateSelect } from '#components/select/DateSelect';
import {
  formatExchangeRate,
  parseExchangeRate,
  useDeleteExchangeRateMutation,
  useSetExchangeRateMutation,
} from '#exchange-rates';
import { useDateFormat } from '#hooks/useDateFormat';

type EditExchangeRateModalProps = {
  fromCurrency: string;
  toCurrency: string;
  exchangeRate?: ExchangeRateEntity;
  date?: string;
};

export function EditExchangeRateModal({
  fromCurrency,
  toCurrency,
  exchangeRate,
  date: initialDate,
}: EditExchangeRateModalProps) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const setExchangeRate = useSetExchangeRateMutation();
  const deleteExchangeRate = useDeleteExchangeRateMutation();

  const [date, setDate] = useState(
    exchangeRate?.date ?? initialDate ?? currentDay(),
  );
  const [rateText, setRateText] = useState(
    exchangeRate ? formatExchangeRate(exchangeRate.rate) : '',
  );
  const [hasRateError, setHasRateError] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();

    const rate = parseExchangeRate(rateText);
    if (rate == null) {
      setHasRateError(true);
      return;
    }

    // A rate is stored per day, so moving it to another day replaces the
    // old one
    if (exchangeRate && exchangeRate.date !== date) {
      deleteExchangeRate.mutate({ id: exchangeRate.id });
    }
    setExchangeRate.mutate({
      date,
      from_currency: fromCurrency,
      to_currency: toCurrency,
      rate,
    });
    close();
  };

  return (
    <Modal name="edit-exchange-rate" containerProps={{ style: { width: 400 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={
                  exchangeRate
                    ? t('Edit exchange rate')
                    : t('Add exchange rate')
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
            <InlineField label={t('Rate')} width="100%">
              <View
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
              >
                <Text style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                  1 {fromCurrency} =
                </Text>
                <InitialFocus>
                  <Input
                    name="rate"
                    inputMode="decimal"
                    aria-label={t('Rate')}
                    value={rateText}
                    onChangeValue={value => {
                      setRateText(value);
                      setHasRateError(false);
                    }}
                    style={{ flex: 1, textAlign: 'right', ...styles.tnum }}
                  />
                </InitialFocus>
                <Text style={{ marginLeft: 8 }}>{toCurrency}</Text>
              </View>
            </InlineField>
            {hasRateError && (
              <FormError style={{ marginLeft: 75 }}>
                <Trans>The rate must be a number greater than zero.</Trans>
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
                Transactions from this date use this rate until the next one.
              </Trans>
            </Text>

            <ModalButtons>
              {exchangeRate && (
                <Button
                  style={{ color: theme.errorText, marginRight: 'auto' }}
                  onPress={() => {
                    deleteExchangeRate.mutate({ id: exchangeRate.id });
                    state.close();
                  }}
                >
                  <Trans>Delete</Trans>
                </Button>
              )}
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
