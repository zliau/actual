import type { ExchangeRateEntity } from '@actual-app/core/types/models';
import { describe, expect, it } from 'vitest';

import { findExchangeRate } from './rates';

function rate(
  id: string,
  date: string,
  value: number,
  overrides: Partial<ExchangeRateEntity> = {},
): ExchangeRateEntity {
  return {
    id,
    date,
    from_currency: 'USD',
    to_currency: 'EUR',
    rate: value,
    source: 'api',
    ...overrides,
  };
}

describe('findExchangeRate', () => {
  it('is 1 between the same currency', () => {
    expect(findExchangeRate([], 'EUR', 'EUR', '2026-01-01')).toBe(1);
  });

  it('is null when no rate is known', () => {
    expect(findExchangeRate([], 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('uses the latest rate on or before the day', () => {
    const rates = [
      rate('a', '2026-01-01', 0.9),
      rate('b', '2026-01-10', 0.95),
      rate('c', '2026-01-20', 0.99),
    ];
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-15')).toBe(0.95);
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-10')).toBe(0.95);
  });

  it('uses the earliest rate after the day when there is none before', () => {
    const rates = [
      rate('a', '2026-01-20', 0.99),
      rate('b', '2026-01-10', 0.95),
    ];
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-01')).toBe(0.95);
  });

  it('prefers a manual rate on the same day', () => {
    const rates = [
      rate('a', '2026-01-10', 0.95),
      rate('b', '2026-01-10', 0.97, { source: 'manual' }),
    ];
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-15')).toBe(0.97);
  });

  it('inverts a rate stored the other way', () => {
    const rates = [
      rate('a', '2026-01-10', 2, { from_currency: 'EUR', to_currency: 'USD' }),
    ];
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-15')).toBe(0.5);
  });

  it('ignores rates for other currencies', () => {
    const rates = [rate('a', '2026-01-10', 1.2, { from_currency: 'GBP' })];
    expect(findExchangeRate(rates, 'USD', 'EUR', '2026-01-15')).toBeNull();
  });
});
