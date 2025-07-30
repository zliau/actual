import * as db from '../db';
import { type ExchangeRateEntity } from '../../types/models/exchange-rate';
import { checkSecret } from '../accounts/app';

// Exchange Rate API configuration
const EXCHANGE_RATE_API_BASE_URL = 'https://v6.exchangerate-api.com/v6';

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

  // Fetch from external API
  const rate = await fetchExchangeRateFromAPI(fromCurrency, toCurrency, date);
  
  const id = `${fromCurrency}_${toCurrency}_${date}`;
  const now = new Date().toISOString();
  
  const exchangeRate: ExchangeRateEntity = {
    id,
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate,
    date,
    source: source || 'exchangerate-api',
    created_at: now,
    updated_at: now,
  };
  
  await db.insert('exchange_rates', exchangeRate);
  
  return exchangeRate;
}

async function fetchExchangeRateFromAPI(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  // Get API key from secret storage
  const apiKeyResult = await checkSecret('exchange_rate_api_key');
  const apiKey = typeof apiKeyResult === 'string' ? apiKeyResult : null;
  
  if (!apiKey) {
    // Fallback to mock rate if no API key is configured
    console.warn('No exchange rate API key configured, using mock rate');
    return 1.25;
  }

  try {
    // Convert date to YYYY-MM-DD format
    const formattedDate = new Date(date).toISOString().split('T')[0];
    
    const url = `${EXCHANGE_RATE_API_BASE_URL}/${apiKey}/history/${fromCurrency}/${formattedDate}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Exchange rate API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.result === 'success' && data.conversion_rates && data.conversion_rates[toCurrency]) {
      return data.conversion_rates[toCurrency];
    } else {
      throw new Error('Invalid response from exchange rate API');
    }
  } catch (error) {
    console.error('Failed to fetch exchange rate:', error);
    // Fallback to mock rate on error
    return 1.25;
  }
}

export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<ExchangeRateEntity | null> {
  const result = await db.first(
    'SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND date = ?',
    [fromCurrency, toCurrency, date],
  );
  
  return result as ExchangeRateEntity | null;
}

export async function storeExchangeRate(exchangeRate: ExchangeRateEntity): Promise<void> {
  await db.insert('exchange_rates', exchangeRate);
} 