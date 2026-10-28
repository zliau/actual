import { getNumberFormat } from '@actual-app/core/shared/util';

// Formats an exchange rate with up to six decimals, enough for both small
// rates (1 JPY = 0.0058 EUR) and large ones, without trailing zeros past two
export function formatExchangeRate(rate: number): string {
  const { formatter, decimalSeparator } = getNumberFormat({
    decimalPlaces: 6,
  });
  const [whole, fraction = ''] = formatter.format(rate).split(decimalSeparator);
  return `${whole}${decimalSeparator}${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

// Reads an exchange rate typed in any common notation. Rates are often
// copied from elsewhere, so a lone separator is read as the decimal point
// unless it is followed by exactly three digits, where the number format
// decides ("1.234" is 1234 with "1.000,33" but 1.234 with "1,000.33").
// Returns null when the text is not a positive number.
export function parseExchangeRate(text: string): number | null {
  const cleaned = text.replace(/[\s  ']/g, '');
  if (!/^\d*[.,]?\d*([.,]\d*)*$/.test(cleaned) || !/\d/.test(cleaned)) {
    return null;
  }

  const separators = cleaned.match(/[.,]/g) ?? [];
  let normalized: string;
  if (separators.length === 0) {
    normalized = cleaned;
  } else if (new Set(separators).size === 2) {
    // With both kinds, the last one is the decimal point
    const decimal = separators[separators.length - 1];
    const thousands = decimal === '.' ? ',' : '.';
    normalized = cleaned.replaceAll(thousands, '').replace(decimal, '.');
  } else if (separators.length > 1) {
    // The same separator several times groups thousands
    normalized = cleaned.replace(/[.,]/g, '');
  } else {
    const separator = cleaned.includes('.') ? '.' : ',';
    const [whole, fraction = ''] = cleaned.split(separator);
    const isThousands =
      fraction.length === 3 &&
      whole !== '' &&
      whole !== '0' &&
      separator === getNumberFormat().thousandsSeparator;
    normalized = isThousands ? whole + fraction : `${whole}.${fraction}`;
  }

  const rate = Number(normalized);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
