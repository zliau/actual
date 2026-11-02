import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  SecurityExchange,
  SecurityPriceEntity,
  SecuritySplitEntity,
  TradeEntity,
} from '@actual-app/core/types/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';

import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { investmentQueries } from './queries';

type TradeFields = Pick<
  TradeEntity,
  'date' | 'type' | 'quantity' | 'price' | 'fee'
>;

// New trades name the symbol, and the security is added if it isn't stored yet
type SaveTradePayload =
  | ({
      account: TradeEntity['account'];
      symbol: string;
      exchange: SecurityExchange;
      name?: string | null;
    } & TradeFields)
  | ({ id: TradeEntity['id'] } & TradeFields);

// Runs a change to investment data, refreshes what shows it and reports errors
function useInvestmentMutation<Payload, Result>(
  mutationFn: (payload: Payload) => Promise<Result>,
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  const dispatch = useDispatch();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: investmentQueries.lists(),
      });
    },
    onError: (error: Error) => {
      console.error(errorMessage, error);
      dispatch(
        addNotification({
          notification: {
            id: uuidv4(),
            type: 'error',
            message: errorMessage,
            pre: error.message,
          },
        }),
      );
    },
  });
}

// Fetches the closes held securities are missing
export function useUpdateSecurityPricesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => send('security-prices-update'),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: investmentQueries.lists(),
      });
    },
  });
}

export function useSaveTradeMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(async (payload: SaveTradePayload) => {
    if ('id' in payload) {
      await send('trade-update', payload);
      return;
    }

    const { symbol, exchange, name, ...trade } = payload;
    const security = await send('security-create', { symbol, exchange, name });
    await send('trade-create', { ...trade, security });
  }, t('There was an error saving the trade. Please try again.'));
}

export function useDeleteTradeMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    ({ id }: Pick<TradeEntity, 'id'>) => send('trade-delete', { id }),
    t('There was an error deleting the trade. Please try again.'),
  );
}

export function useSetSecurityPriceMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    (price: Pick<SecurityPriceEntity, 'security' | 'date' | 'close'>) =>
      send('security-price-set', price),
    t('There was an error saving the price. Please try again.'),
  );
}

export function useDeleteSecurityPriceMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    ({ id }: Pick<SecurityPriceEntity, 'id'>) =>
      send('security-price-delete', { id }),
    t('There was an error deleting the price. Please try again.'),
  );
}

export function useSetSecuritySplitMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    (split: Pick<SecuritySplitEntity, 'security' | 'date' | 'ratio'>) =>
      send('security-split-set', split),
    t('There was an error saving the split. Please try again.'),
  );
}

export function useDismissSecuritySplitMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    ({ id }: Pick<SecuritySplitEntity, 'id'>) =>
      send('security-split-dismiss', { id }),
    t('There was an error saving the split. Please try again.'),
  );
}

export function useDeleteSecuritySplitMutation() {
  const { t } = useTranslation();

  return useInvestmentMutation(
    ({ id }: Pick<SecuritySplitEntity, 'id'>) =>
      send('security-split-delete', { id }),
    t('There was an error deleting the split. Please try again.'),
  );
}
