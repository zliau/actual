import { describe, expect, it } from 'vitest';

import { getConvertedAmount } from './useConvertedAmount';

const getRate = (currency: string | null): number =>
  currency === 'USD' ? 0.9 : 1;
const noRate = (currency: string | null): number =>
  currency === 'USD' ? 0 : 1;

function convert(
  transaction: { id: string; converted_amount?: number | null },
  currency: string | null = 'USD',
  rates = getRate,
) {
  return getConvertedAmount({
    transaction: { date: '2026-01-01', amount: -1000, ...transaction },
    currency,
    mainCurrency: 'EUR',
    getRate: rates,
  });
}

describe('getConvertedAmount', () => {
  it('uses the stored conversion of a saved transaction', () => {
    expect(convert({ id: 'a', converted_amount: -950 })).toEqual({
      value: -950,
      isMissingRate: false,
    });
  });

  it('reports a saved transaction without a conversion', () => {
    expect(convert({ id: 'a', converted_amount: null })).toEqual({
      value: null,
      isMissingRate: true,
    });
  });

  it('keeps the amount in the main currency', () => {
    expect(convert({ id: 'a' }, null)).toEqual({
      value: -1000,
      isMissingRate: false,
    });
  });

  it('estimates a scheduled transaction', () => {
    expect(convert({ id: 'preview/s/2026-01-01' })).toEqual({
      value: -900,
      isMissingRate: false,
    });
  });

  it('shows nothing for a scheduled transaction without a rate', () => {
    expect(convert({ id: 'preview/s/2026-01-01' }, 'USD', noRate)).toEqual({
      value: null,
      isMissingRate: false,
    });
  });

  it('has no conversion for an unsaved transaction', () => {
    expect(convert({ id: 'temp' })).toEqual({
      value: null,
      isMissingRate: false,
    });
  });
});
