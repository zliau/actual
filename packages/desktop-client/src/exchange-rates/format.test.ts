import { setNumberFormat } from '@actual-app/core/shared/util';

import { formatExchangeRate, parseExchangeRate } from './format';

describe('parseExchangeRate', () => {
  afterEach(() => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
  });

  it('reads a decimal point or comma', () => {
    expect(parseExchangeRate('0.9123')).toBe(0.9123);
    expect(parseExchangeRate('0,9123')).toBe(0.9123);
    expect(parseExchangeRate(' 1.08 ')).toBe(1.08);
    expect(parseExchangeRate('.5')).toBe(0.5);
  });

  it('reads thousands separators', () => {
    expect(parseExchangeRate('15,873.5')).toBe(15873.5);
    expect(parseExchangeRate('15.873,5')).toBe(15873.5);
    expect(parseExchangeRate('1,234,567')).toBe(1234567);
    expect(parseExchangeRate('15 873,5')).toBe(15873.5);
  });

  it('uses the number format when three digits follow the separator', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    expect(parseExchangeRate('1,234')).toBe(1234);
    expect(parseExchangeRate('1.234')).toBe(1.234);
    expect(parseExchangeRate('0,123')).toBe(0.123);

    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    expect(parseExchangeRate('1.234')).toBe(1234);
    expect(parseExchangeRate('1,234')).toBe(1.234);
    // A rate typed with a decimal point in a comma locale
    expect(parseExchangeRate('0.9123')).toBe(0.9123);
  });

  it('rejects text that is not a positive number', () => {
    expect(parseExchangeRate('')).toBeNull();
    expect(parseExchangeRate('abc')).toBeNull();
    expect(parseExchangeRate('0')).toBeNull();
    expect(parseExchangeRate('-1')).toBeNull();
    expect(parseExchangeRate('1.2.3,4,5')).toBeNull();
  });
});

describe('formatExchangeRate', () => {
  it('keeps the significant decimals of small and large rates', () => {
    expect(formatExchangeRate(0.9123)).toBe('0.9123');
    expect(formatExchangeRate(0.005812)).toBe('0.005812');
    expect(formatExchangeRate(15873.5)).toBe('15,873.50');
    expect(formatExchangeRate(1)).toBe('1.00');
  });
});
