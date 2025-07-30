import React, { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

import { send } from 'loot-core/platform/client/fetch';
import { getSecretsError } from 'loot-core/shared/errors';

import { Error } from '@desktop-client/components/alerts';
import { Link } from '@desktop-client/components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { FormField, FormLabel } from '@desktop-client/components/forms';
import { type Modal as ModalType } from '@desktop-client/modals/modalsSlice';

type ExchangeRateApiKeyModalProps = Extract<
  ModalType,
  { name: 'exchange-rate-api-key' }
>['options'];

export const ExchangeRateApiKeyModal = ({
  onSuccess,
}: ExchangeRateApiKeyModalProps) => {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(t('It is required to provide an API key.'));

  const onSubmit = async (close: () => void) => {
    if (!apiKey) {
      setIsValid(false);
      return;
    }

    setIsLoading(true);

    const { error, reason } =
      (await send('secret-set', {
        name: 'exchange_rate_api_key',
        value: apiKey,
      })) || {};

    if (error) {
      setIsValid(false);
      setError(getSecretsError(error, reason));
    } else {
      onSuccess();
    }
    setIsLoading(false);
    close();
  };

  return (
    <Modal name="exchange-rate-api-key" containerProps={{ style: { width: 400 } }}>
      {({ state: { close } }) => (
        <>
          <ModalHeader
            title={t('Exchange Rate API Key')}
            rightContent={<ModalCloseButton onPress={close} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                To enable real-time exchange rates for multi-currency transactions, 
                you need to provide an API key from{' '}
                <Link
                  variant="external"
                  to="https://openexchangerates.org/"
                  linkColor="purple"
                >
                  OpenExchangeRates
                </Link>
                . This service provides accurate historical and current exchange rates.
              </Trans>
            </Text>

            <Text style={{ fontSize: 12, color: 'var(--color-text-subdued)' }}>
              <Trans>
                <strong>Note:</strong> The API key is stored securely and is only used 
                to fetch exchange rates. You can get a free API key by signing up at 
                the OpenExchangeRates website.
              </Trans>
            </Text>

            <FormField>
              <FormLabel title={t('API Key:')} htmlFor="api-key-field" />
              <Input
                id="api-key-field"
                type="password"
                value={apiKey}
                onChangeValue={value => {
                  setApiKey(value);
                  setIsValid(true);
                }}
                placeholder="Enter your OpenExchangeRates API key"
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              autoFocus
              isLoading={isLoading}
              onPress={() => {
                onSubmit(close);
              }}
            >
              <Trans>Save API Key</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}; 