import { send } from '@actual-app/core/platform/client/connection';
import type { ExchangeRateEntity } from '@actual-app/core/types/models';

// Loads the rates between each currency and the main currency, in either
// direction
export async function loadExchangeRates(
  currencies: string[],
  mainCurrency: string,
): Promise<ExchangeRateEntity[]> {
  const results = await Promise.all(
    currencies
      .filter(currency => currency !== mainCurrency)
      .flatMap(currency => [
        send('exchange-rates-get', {
          from_currency: currency,
          to_currency: mainCurrency,
        }),
        send('exchange-rates-get', {
          from_currency: mainCurrency,
          to_currency: currency,
        }),
      ]),
  );
  return results.flat();
}

// Loads what's needed to value balances in the main currency. The result gives
// how many units of the main currency one unit of `currency` is worth on `date`:
// 1 for the main currency or when there is none, and 0 when no rate is known,
// since those balances can't be valued and don't count towards totals.
export async function loadRatesToMainCurrency(
  currencies: Array<string | null | undefined>,
  mainCurrency: string | null,
): Promise<(currency: string | null | undefined, date: string) => number> {
  if (!mainCurrency) {
    return () => 1;
  }
  const foreignCurrencies = [
    ...new Set(currencies.filter(currency => currency != null)),
  ];
  const rates = await loadExchangeRates(foreignCurrencies, mainCurrency);

  return (currency, date) =>
    currency ? (findExchangeRate(rates, currency, mainCurrency, date) ?? 0) : 1;
}

// Returns how many units of `toCurrency` one unit of `fromCurrency` is worth
// on `date`, picked the same way as on the server: the latest rate on or
// before that day, or the earliest one after it when there is none before,
// preferring manual rates and then the direct pair. A rate stored for the
// opposite direction is inverted. Returns null when no rate is known.
export function findExchangeRate(
  rates: ExchangeRateEntity[],
  fromCurrency: string,
  toCurrency: string,
  date: string,
): number | null {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  let best: ExchangeRateEntity | null = null;
  for (const rate of rates) {
    const isDirect =
      rate.from_currency === fromCurrency && rate.to_currency === toCurrency;
    const isInverse =
      rate.from_currency === toCurrency && rate.to_currency === fromCurrency;
    if (
      (isDirect || isInverse) &&
      (!best || compareRates(rate, best, fromCurrency, date) < 0)
    ) {
      best = rate;
    }
  }

  if (!best) {
    return null;
  }
  return best.from_currency === fromCurrency ? best.rate : 1 / best.rate;
}

function compareRates(
  a: ExchangeRateEntity,
  b: ExchangeRateEntity,
  fromCurrency: string,
  date: string,
) {
  const isAfterA = a.date > date;
  const isAfterB = b.date > date;
  if (isAfterA !== isAfterB) {
    return isAfterA ? 1 : -1;
  }
  if (a.date !== b.date) {
    // Closest to the day first
    return a.date < b.date === isAfterA ? -1 : 1;
  }
  const isManualA = a.source === 'manual';
  const isManualB = b.source === 'manual';
  if (isManualA !== isManualB) {
    return isManualA ? -1 : 1;
  }
  const isDirectA = a.from_currency === fromCurrency;
  const isDirectB = b.from_currency === fromCurrency;
  if (isDirectA !== isDirectB) {
    return isDirectA ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}
