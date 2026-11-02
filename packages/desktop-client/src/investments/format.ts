import { getNumberFormat } from '@actual-app/core/shared/util';

// Formats with up to six decimals and no trailing zeros, keeping at least
// `minDecimals` of them
function formatDecimal(value: number, minDecimals: number): string {
  const { formatter, decimalSeparator } = getNumberFormat({
    decimalPlaces: 6,
  });
  const [whole, fraction = ''] = formatter
    .format(value)
    .split(decimalSeparator);
  const trimmed = fraction.replace(/0+$/, '').padEnd(minDecimals, '0');
  return trimmed ? `${whole}${decimalSeparator}${trimmed}` : whole;
}

// Whole shares stay short (10), while fractional ones show their precision
// (0.123456)
export function formatShares(quantity: number): string {
  return formatDecimal(quantity, 0);
}

// Prices keep cents and can go further, for low priced shares
export function formatSharePrice(price: number): string {
  return formatDecimal(price, 2);
}

// A split as people say it: a ratio of 4 is 4 for 1, and 0.1 is 1 for 10
export function formatSplitRatio(ratio: number): string {
  return ratio >= 1
    ? `${formatDecimal(ratio, 0)} : 1`
    : `1 : ${formatDecimal(Number((1 / ratio).toFixed(6)), 0)}`;
}

// A share of the cost as a signed percentage: 0.1 is +10.0%
export function formatGainRatio(ratio: number): string {
  const percent = ratio * 100;
  const { formatter, decimalSeparator } = getNumberFormat({ decimalPlaces: 1 });
  const [whole, fraction = '0'] = formatter
    .format(Math.abs(percent))
    .split(decimalSeparator);
  const isZero = whole === '0' && fraction === '0';
  const sign = isZero ? '' : percent > 0 ? '+' : '-';
  return `${sign}${whole}${decimalSeparator}${fraction}%`;
}
