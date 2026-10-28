import { useEffect, useEffectEvent, useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { q } from '@actual-app/core/shared/query';
import type { TransactionEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { TransferAmountField } from '#components/modals/TransferAmountField';
import { formatExchangeRate } from '#exchange-rates';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';
import { useMainCurrency } from '#hooks/useMainCurrency';
import { aqlQuery } from '#queries/aqlQuery';

type TransferAmountsModalProps = {
  transactionId: TransactionEntity['id'];
};

// Edits what left one account and what arrived in the other for a transfer
// between accounts in different currencies
export function TransferAmountsModal({
  transactionId,
}: TransferAmountsModalProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const mainCurrency = useMainCurrency();
  const { data: accounts = [] } = useAccounts();

  const [sides, setSides] = useState<{
    sent: TransactionEntity;
    received: TransactionEntity;
  } | null>(null);
  const [sentText, setSentText] = useState('');
  const [receivedText, setReceivedText] = useState('');
  const [hasError, setHasError] = useState(false);

  const onLoad = useEffectEvent(
    (sent: TransactionEntity, received: TransactionEntity) => {
      setSides({ sent, received });
      setSentText(format.forEdit(Math.abs(sent.amount)));
      setReceivedText(format.forEdit(Math.abs(received.amount)));
    },
  );

  useEffect(() => {
    let isCurrent = true;
    async function load() {
      const { data } = await aqlQuery(
        q('transactions')
          .filter({
            $or: [{ id: transactionId }, { transfer_id: transactionId }],
          })
          .options({ splits: 'all' })
          .select('*'),
      );
      const rows = data as TransactionEntity[];
      const transaction = rows.find(row => row.id === transactionId);
      const other = rows.find(row => row.id !== transactionId);
      if (!isCurrent || !transaction || !other) {
        return;
      }
      // Show the side money left from first
      const [sent, received] =
        transaction.amount <= 0 ? [transaction, other] : [other, transaction];
      onLoad(sent, received);
    }
    void load();
    return () => {
      isCurrent = false;
    };
  }, [transactionId]);

  const accountOf = (transaction: TransactionEntity) =>
    accounts.find(account => account.id === transaction.account);
  const currencyOf = (transaction: TransactionEntity) =>
    accountOf(transaction)?.currency ?? mainCurrency ?? '';

  const sentAmount = format.fromEdit(sentText);
  const receivedAmount = format.fromEdit(receivedText);
  const impliedRate =
    sentAmount && receivedAmount
      ? Math.abs(receivedAmount) / Math.abs(sentAmount)
      : null;

  const onSubmit = async (
    event: FormEvent<HTMLFormElement>,
    close: () => void,
  ) => {
    event.preventDefault();
    if (!sides || sentAmount == null || receivedAmount == null) {
      setHasError(true);
      return;
    }

    await send('transactions-batch-update', {
      updated: [
        { id: sides.sent.id, amount: -Math.abs(sentAmount) },
        { id: sides.received.id, amount: Math.abs(receivedAmount) },
      ],
    });
    close();
  };

  return (
    <Modal name="transfer-amounts" containerProps={{ style: { width: 420 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle title={t('Transfer amounts')} shrinkOnOverflow />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {sides && (
            <Form onSubmit={event => onSubmit(event, () => state.close())}>
              <View style={{ gap: 12 }}>
                <Text style={{ color: theme.pageTextLight, lineHeight: 1.5 }}>
                  <Trans>
                    Enter what left one account and what arrived in the other.
                    The difference is the exchange rate and any fees.
                  </Trans>
                </Text>
                <TransferAmountField
                  label={t('Sent from {{account}}', {
                    account: accountOf(sides.sent)?.name ?? '',
                  })}
                  currency={currencyOf(sides.sent)}
                  value={sentText}
                  onChange={value => {
                    setSentText(value);
                    setHasError(false);
                  }}
                  autoFocus
                />
                <TransferAmountField
                  label={t('Received in {{account}}', {
                    account: accountOf(sides.received)?.name ?? '',
                  })}
                  currency={currencyOf(sides.received)}
                  value={receivedText}
                  onChange={value => {
                    setReceivedText(value);
                    setHasError(false);
                  }}
                />
                {hasError ? (
                  <FormError>
                    <Trans>Enter both amounts as numbers.</Trans>
                  </FormError>
                ) : (
                  impliedRate != null && (
                    <Text
                      style={{ color: theme.pageTextSubdued, ...styles.tnum }}
                    >
                      <Trans>
                        1 {{ from: currencyOf(sides.sent) }} ={' '}
                        {{ rate: formatExchangeRate(impliedRate) }}{' '}
                        {{ to: currencyOf(sides.received) }}
                      </Trans>
                    </Text>
                  )
                )}
              </View>
              <ModalButtons>
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
          )}
        </>
      )}
    </Modal>
  );
}
