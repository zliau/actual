import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { send } from '@actual-app/core/platform/client/connection';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Link } from '#components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useCurrentAccess } from '#hooks/useCurrentAccess';
import {
  investmentQueries,
  useUpdateSecurityPricesMutation,
} from '#investments';
import { getSecretsError } from '#util/error';

// The key belongs to the server, for everyone using it, and is never shown again
export function SecurityPriceSetupModal() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isAdmin } = useCurrentAccess();
  const { data: status } = useQuery(investmentQueries.priceStatus());
  const updatePrices = useUpdateSecurityPricesMutation();
  const [tiingoToken, setTiingoToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const hasKey = !!status && !('error' in status) && status.US;

  const onSubmit = async (
    event: FormEvent<HTMLFormElement>,
    close: () => void,
  ) => {
    event.preventDefault();

    const secrets = [
      { name: 'tiingo_token', value: tiingoToken.trim() },
    ].filter(secret => secret.value !== '');

    setIsSaving(true);
    for (const secret of secrets) {
      const response = await send('secret-set', { ...secret, fileId: null });
      const { error: failure, reason } = (response ?? {}) as {
        error?: string;
        reason?: string;
      };
      if (failure) {
        setIsSaving(false);
        setError(getSecretsError(failure, reason ?? ''));
        return;
      }
    }
    setIsSaving(false);

    await queryClient.invalidateQueries({
      queryKey: investmentQueries.priceStatus().queryKey,
    });
    if (secrets.length > 0) {
      updatePrices.mutate();
    }
    close();
  };

  return (
    <Modal
      name="security-price-setup"
      containerProps={{ style: { width: 460 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Price updates')} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {isAdmin ? (
            <Form onSubmit={event => void onSubmit(event, () => state.close())}>
              <Text
                style={{
                  color: theme.pageTextLight,
                  lineHeight: 1.5,
                  marginBottom: 10,
                }}
              >
                <Trans>
                  Actual gets daily closing prices of US stocks from{' '}
                  <Link
                    variant="external"
                    linkColor="muted"
                    to="https://www.tiingo.com/account/api/token"
                  >
                    Tiingo
                  </Link>
                  , which gives free keys for personal use. The key is kept on
                  your server. Toronto prices come from Yahoo Finance and need
                  no key.
                </Trans>
              </Text>
              <InlineField label={t('Tiingo')} labelWidth={120} width="100%">
                <Input
                  name="tiingo-token"
                  type="password"
                  autoComplete="off"
                  aria-label={t('Tiingo token')}
                  placeholder={hasKey ? t('Saved') : undefined}
                  value={tiingoToken}
                  onChangeValue={value => {
                    setTiingoToken(value);
                    setError(null);
                  }}
                  style={{ flex: 1 }}
                />
              </InlineField>
              {error && <FormError style={{ marginTop: 5 }}>{error}</FormError>}
              <ModalButtons>
                <Button onPress={() => state.close()}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={isSaving}
                  style={{ marginLeft: 10 }}
                >
                  <Trans>Save</Trans>
                </Button>
              </ModalButtons>
            </Form>
          ) : (
            <Text style={{ color: theme.pageTextLight, lineHeight: 1.5 }}>
              <Trans>
                Only the server's administrator can set up price updates. Until
                then, you can enter prices yourself.
              </Trans>
            </Text>
          )}
        </>
      )}
    </Modal>
  );
}
