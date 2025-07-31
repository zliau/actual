import * as db from '../db';
import { type ExchangeRateEntity } from '../../types/models/exchange-rate';
import * as asyncStorage from '../../platform/server/asyncStorage';
import { getServer } from '../server-config';
import { post } from '../post';





export async function fetchAndStoreExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
  source?: string,
): Promise<ExchangeRateEntity> {
  // Check if we already have this exchange rate
  const existing = await getExchangeRate(fromCurrency, toCurrency, date);
  if (existing) {
    return existing;
  }

  // Get user token for authentication (following SimpleFin pattern)
  const userToken = await asyncStorage.getItem('user-token');
  if (!userToken) {
    throw new Error('No user token available for exchange rate fetching');
  }

  // Get server config
  const serverConfig = getServer();
  if (!serverConfig) {
    throw new Error('Failed to get server config.');
  }

  // Call sync-server to fetch exchange rate
  const response = await post(
    serverConfig.BASE_SERVER + '/exchange-rates/fetch',
    {
      fromCurrency,
      toCurrency,
      date,
    },
    {
      'X-ACTUAL-TOKEN': userToken,
    },
  );

  if (response.status === 'error') {
    throw new Error(response.error || 'Failed to fetch exchange rate');
  }

  const rate = response.rate;
  
  const id = `${fromCurrency}_${toCurrency}_${date}`;
  
  const exchangeRate: ExchangeRateEntity = {
    id,
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate,
    date,
  };
  
  await db.insert('exchange_rates', exchangeRate);
  
  return exchangeRate;
}





export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<ExchangeRateEntity | null> {
  const result = await db.first(
    'SELECT id, from_currency, to_currency, rate, date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND date = ?',
    [fromCurrency, toCurrency, date],
  );
  
  return result as ExchangeRateEntity | null;
}

export async function storeExchangeRate(exchangeRate: ExchangeRateEntity): Promise<void> {
  await db.insert('exchange_rates', exchangeRate);
} 