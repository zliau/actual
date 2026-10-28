import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type { ExchangeRateEntity } from '@actual-app/core/types/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';

import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import type { AppDispatch } from '#redux/store';

import { exchangeRateQueries } from './queries';

const invalidateQueries = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({
    queryKey: exchangeRateQueries.lists(),
  });
};

const dispatchErrorNotification = (
  dispatch: AppDispatch,
  message: string,
  error?: Error,
) => {
  dispatch(
    addNotification({
      notification: {
        id: uuidv4(),
        type: 'error',
        message,
        pre: error ? error.message : undefined,
      },
    }),
  );
};

type SetExchangeRatePayload = Pick<
  ExchangeRateEntity,
  'date' | 'from_currency' | 'to_currency' | 'rate'
>;

export function useSetExchangeRateMutation() {
  const queryClient = useQueryClient();
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (exchangeRate: SetExchangeRatePayload) =>
      send('exchange-rate-set', exchangeRate),
    onSuccess: () => invalidateQueries(queryClient),
    onError: error => {
      console.error('Error saving exchange rate:', error);
      dispatchErrorNotification(
        dispatch,
        t('There was an error saving the exchange rate. Please try again.'),
        error,
      );
    },
  });
}

export function useDeleteExchangeRateMutation() {
  const queryClient = useQueryClient();
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ id }: Pick<ExchangeRateEntity, 'id'>) =>
      send('exchange-rate-delete', { id }),
    onSuccess: () => invalidateQueries(queryClient),
    onError: error => {
      console.error('Error deleting exchange rate:', error);
      dispatchErrorNotification(
        dispatch,
        t('There was an error deleting the exchange rate. Please try again.'),
        error,
      );
    },
  });
}

// Fetches the exchange rates missing since the last fetch
export function useUpdateExchangeRatesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => send('exchange-rates-update'),
    onSuccess: () => invalidateQueries(queryClient),
  });
}
