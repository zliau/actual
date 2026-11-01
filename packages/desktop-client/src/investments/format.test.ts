import { setNumberFormat } from '@actual-app/core/shared/util';

import { formatGainRatio, formatSharePrice, formatShares } from './format';

describe('investment formats', () => {
  beforeEach(() => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
  });

  it('shows shares without needless decimals', () => {
    expect(formatShares(10)).toBe('10');
    expect(formatShares(1234.5)).toBe('1,234.5');
    expect(formatShares(0.123456)).toBe('0.123456');
  });

  it('shows prices with at least cents', () => {
    expect(formatSharePrice(100)).toBe('100.00');
    expect(formatSharePrice(100.5)).toBe('100.50');
    expect(formatSharePrice(0.0123)).toBe('0.0123');
  });

  it('keeps precision when fractions are hidden', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    expect(formatShares(0.5)).toBe('0.5');
    expect(formatSharePrice(100.25)).toBe('100.25');
  });

  it('signs gains and losses', () => {
    expect(formatGainRatio(0.1)).toBe('+10.0%');
    expect(formatGainRatio(-0.255)).toBe('-25.5%');
    expect(formatGainRatio(0)).toBe('0.0%');
    expect(formatGainRatio(-0.0001)).toBe('0.0%');
  });
});
