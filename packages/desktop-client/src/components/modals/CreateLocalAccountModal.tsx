// @ts-strict-ignore
import { type FormEvent, useState } from 'react';
import { Form } from 'react-aria-components';
import { useTranslation, Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { closeModal } from 'loot-core/client/modals/modalsSlice';
import { createAccount } from 'loot-core/client/queries/queriesSlice';
import { toRelaxedNumber } from 'loot-core/shared/util';

import * as useAccounts from '../../hooks/useAccounts';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useNavigate } from '../../hooks/useNavigate';
import { useDispatch } from '../../redux';
import { Link } from '../common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '../common/Modal';
import { Select } from '../common/Select';
import { Text } from '../common/Text';
import { View } from '../common/View';
import { Checkbox } from '../forms';
import { validateAccountName } from '../util/accountValidation';
import { useSyncedPref } from '../../hooks/useSyncedPref';

const currencies: { value: string; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'CAD', label: 'CAD' },
];

export function CreateLocalAccountModal() {
  const { t } = useTranslation();
  const [currencyPref, _] = useSyncedPref('currency');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const accounts = useAccounts.useAccounts();
  const [name, setName] = useState('');
  const [offbudget, setOffbudget] = useState(false);
  const [balance, setBalance] = useState('0');
  const [currency, setCurrency] = useState(currencyPref); // FIXME when multicurrency not enabled it still shows the usd header

  const [nameError, setNameError] = useState(null);
  const [balanceError, setBalanceError] = useState(false);

  const multiCurrencyFeatureFlag = useFeatureFlag('multiCurrency');

  const validateBalance = balance => !isNaN(parseFloat(balance));

  const validateAndSetName = (name: string) => {
    const nameError = validateAccountName(name, '', accounts);
    if (nameError) {
      setNameError(nameError);
    } else {
      setName(name);
      setNameError(null);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nameError = validateAccountName(name, '', accounts);

    const balanceError = !validateBalance(balance);
    setBalanceError(balanceError);

    if (!nameError && !balanceError) {
      dispatch(closeModal());
      const id = await dispatch(
        createAccount({
          name,
          balance: toRelaxedNumber(balance),
          offBudget: offbudget,
          currency,
        }),
      ).unwrap();
      navigate('/accounts/' + id);
    }
  };
  return (
    <Modal name="add-local-account">
      {({ state: { close } }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle title={t('Create Local Account')} shrinkOnOverflow />
            }
            rightContent={<ModalCloseButton onPress={close} />}
          />
          <View>
            <Form onSubmit={onSubmit}>
              <InlineField label={t('Name')} width="100%">
                <InitialFocus>
                  <Input
                    name="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onBlur={event => {
                      const name = event.target.value.trim();
                      validateAndSetName(name);
                    }}
                    style={{ flex: 1 }}
                  />
                </InitialFocus>
              </InlineField>
              {nameError && (
                <FormError style={{ marginLeft: 75, color: theme.warningText }}>
                  {nameError}
                </FormError>
              )}

              <View
                style={{
                  width: '100%',
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                }}
              >
                <View style={{ flexDirection: 'column' }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Checkbox
                      id="offbudget"
                      name="offbudget"
                      checked={offbudget}
                      onChange={() => setOffbudget(!offbudget)}
                    />
                    <label
                      htmlFor="offbudget"
                      style={{
                        userSelect: 'none',
                        verticalAlign: 'center',
                      }}
                    >
                      <Trans>Off budget</Trans>
                    </label>
                  </View>
                  <div
                    style={{
                      textAlign: 'right',
                      fontSize: '0.7em',
                      color: theme.pageTextLight,
                      marginTop: 3,
                    }}
                  >
                    <Text>
                      <Trans>
                        This cannot be changed later. See{' '}
                        <Link
                          variant="external"
                          linkColor="muted"
                          to="https://actualbudget.org/docs/accounts/#off-budget-accounts"
                        >
                          Accounts Overview
                        </Link>{' '}
                        for more information.
                      </Trans>
                    </Text>
                  </div>
                </View>
              </View>

              <InlineField label={t('Balance')} width="100%">
                <Input
                  name="balance"
                  inputMode="decimal"
                  value={balance}
                  onChange={event => setBalance(event.target.value)}
                  onBlur={event => {
                    const balance = event.target.value.trim();
                    setBalance(balance);
                    if (validateBalance(balance) && balanceError) {
                      setBalanceError(false);
                    }
                  }}
                  style={{ flex: 1 }}
                />
              </InlineField>
              {balanceError && (
                <FormError style={{ marginLeft: 75 }}>
                  {t('Balance must be a number')}
                </FormError>
              )}
              {multiCurrencyFeatureFlag && (
                <InlineField label="Currency" width="100%">
                  <Select
                    onChange={value => setCurrency(value)}
                    value={currency}
                    options={currencies.map(c => [c.value, c.label])}
                  />
                </InlineField>
              )}

              <ModalButtons>
                <Button onPress={close}>{t('Back')}</Button>
                <Button
                  type="submit"
                  variant="primary"
                  style={{ marginLeft: 10 }}
                >
                  {t('Create')}
                </Button>
              </ModalButtons>
            </Form>
          </View>
        </>
      )}
    </Modal>
  );
}
