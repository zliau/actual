import * as db from '../db';
import { v4 as uuidv4 } from 'uuid';

interface ExchangeRateResponse {
  success: boolean;
  rates: Record<string, number>;
  base: string;
  date: string;
}

export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  // Check if we have a cached rate for this date
  const cachedRate = await db.first<{ rate: number }>(
    'SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND date = ?',
    [fromCurrency, toCurrency, date],
  );

  if (cachedRate) {
    return cachedRate.rate;
  }

  // Fetch from API if not cached
  const rate = await fetchExchangeRateFromAPI(fromCurrency, toCurrency, date);
  
  // Cache the rate
  await db.runQuery(
    'INSERT INTO exchange_rates (id, from_currency, to_currency, rate, date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), fromCurrency, toCurrency, rate, date, new Date().toISOString()],
  );

  return rate;
}

async function fetchExchangeRateFromAPI(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  try {
    // Using exchangerate-api.com (free tier)
    const response = await fetch(
      `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch exchange rate: ${response.statusText}`);
    }

    const data: ExchangeRateResponse = await response.json();
    
    if (!data.success && !data.rates) {
      throw new Error('Invalid response from exchange rate API');
    }

    const rate = data.rates[toCurrency];
    if (!rate) {
      throw new Error(`Exchange rate not found for ${toCurrency}`);
    }

    return rate;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    
    // Fallback: return 1.0 if same currency, or throw error
    if (fromCurrency === toCurrency) {
      return 1.0;
    }
    
    throw new Error(`Failed to get exchange rate for ${fromCurrency} to ${toCurrency}: ${error.message}`);
  }
}

export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const rate = await getExchangeRate(fromCurrency, toCurrency, date);
  return amount * rate;
}

export async function getOriginalAmount(
  convertedAmount: number,
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return convertedAmount;
  }

  const rate = await getExchangeRate(fromCurrency, toCurrency, date);
  return convertedAmount / rate;
} 