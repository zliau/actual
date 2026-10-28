import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useUpdateAccountMutation } from '#accounts';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useAccount } from '#hooks/useAccount';
import { useAccountCurrencyOptions } from '#hooks/useCurrencyOptions';
import { useMainCurrency } from '#hooks/useMainCurrency';

type AccountCurrencyModalProps = {
  accountId: AccountEntity['id'];
};

export function AccountCurrencyModal({ accountId }: AccountCurrencyModalProps) {
  const { t } = useTranslation();
  const account = useAccount(accountId);
  const mainCurrency = useMainCurrency();
  const currencyOptions = useAccountCurrencyOptions();
  const updateAccount = useUpdateAccountMutation();

  // An empty code is the main currency
  const [currency, setCurrency] = useState(
    account?.currency != null && account.currency !== mainCurrency
      ? account.currency
      : '',
  );

  return (
    <Modal name="account-currency" containerProps={{ style: { width: 400 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle title={t('Account currency')} shrinkOnOverflow />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 15 }}>
            <Text style={{ color: theme.pageTextLight, lineHeight: 1.5 }}>
              <Trans>
                Amounts in {{ account: account?.name ?? '' }} stay as they are
                and are read in the new currency. Totals convert them to{' '}
                {{ mainCurrency: mainCurrency ?? '' }} with the exchange rates.
              </Trans>
            </Text>
            <Select
              aria-label={t('Currency')}
              value={currency}
              onChange={setCurrency}
              options={currencyOptions}
              style={{ width: '100%' }}
            />
          </View>
          <ModalButtons>
            <Button onPress={() => state.close()}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="primary"
              style={{ marginLeft: 10 }}
              onPress={() => {
                updateAccount.mutate({
                  account: { id: accountId, currency: currency || null },
                });
                state.close();
              }}
            >
              <Trans>Save</Trans>
            </Button>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}
