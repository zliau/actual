import React from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { Link } from '@desktop-client/components/common/Link';

import { useDispatch } from '@desktop-client/redux';
import { pushModal } from '@desktop-client/modals/modalsSlice';
import { Setting } from './UI';

export function ExchangeRateSettings() {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const handleOpenModal = () => {
    dispatch(
      pushModal({
        modal: {
          name: 'exchange-rate-api-key',
          options: {
            onSuccess: () => {
              // API key was successfully set
            },
          },
        },
      }),
    );
  };



  return (
    <Setting
      primaryAction={
        <Button onPress={handleOpenModal}>
          <Trans>Configure API Key</Trans>
        </Button>
      }
    >
      <Text>
        <Trans>
          <strong>OpenExchangeRates API Key.</strong> To enable real-time exchange 
          rates for multi-currency transactions, you need to provide an API key 
          from{' '}
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
      <Text style={{ fontSize: 12, color: 'var(--color-text-subdued)', marginTop: 5 }}>
        <Trans>
          <strong>Note:</strong> The API key is stored securely and is only used 
          to fetch exchange rates. You can get a free API key by signing up at 
          the OpenExchangeRates website.
        </Trans>
      </Text>
    </Setting>
  );
} 