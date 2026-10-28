import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { currencies } from '@actual-app/core/shared/currencies';

import { useMainCurrency } from './useMainCurrency';

/**
 * Select options for every supported currency, as `[code, label]` pairs with
 * translated names. The first option is "None" with an empty code.
 */
export function useCurrencyOptions(): [string, string][] {
  const { t } = useTranslation();

  const currencyTranslations = useMemo(
    () =>
      new Map<string, string>([
        ['', t('None')],
        ['AED', t('UAE Dirham')],
        ['ARS', t('Argentinian Peso')],
        ['AUD', t('Australian Dollar')],
        ['BDT', t('Bangladeshi Taka')],
        ['BRL', t('Brazilian Real')],
        ['BYN', t('Belarusian Ruble')],
        ['CAD', t('Canadian Dollar')],
        ['CHF', t('Swiss Franc')],
        ['CLP', t('Chilean Peso')],
        ['CNY', t('Yuan Renminbi')],
        ['COP', t('Colombian Peso')],
        ['CRC', t('Costa Rican Colón')],
        ['CZK', t('Czech Koruna')],
        ['DKK', t('Danish Krone')],
        ['DOP', t('Dominican Peso')],
        ['EGP', t('Egyptian Pound')],
        ['EUR', t('Euro')],
        ['GBP', t('Pound Sterling')],
        ['GTQ', t('Guatemalan Quetzal')],
        ['HKD', t('Hong Kong Dollar')],
        ['HUF', t('Hungarian Forint')],
        ['IDR', t('Indonesian Rupiah')],
        ['ILS', t('Israeli New Shekel')],
        ['INR', t('Indian Rupee')],
        ['IRR', t('Iranian Rial')],
        ['JMD', t('Jamaican Dollar')],
        ['JPY', t('Japanese Yen')],
        ['KRW', t('South Korean Won')],
        ['LKR', t('Sri Lankan Rupee')],
        ['MDL', t('Moldovan Leu')],
        ['MKD', t('Macedonian Denar')],
        ['MXN', t('Mexican Peso')],
        ['MYR', t('Malaysian Ringgit')],
        ['NOK', t('Norwegian Krone')],
        ['PEN', t('Peruvian Sol')],
        ['PHP', t('Philippine Peso')],
        ['PKR', t('Pakistani Rupee')],
        ['PLN', t('Polish Złoty')],
        ['QAR', t('Qatari Riyal')],
        ['RON', t('Romanian Leu')],
        ['RSD', t('Serbian Dinar')],
        ['RUB', t('Russian Ruble')],
        ['SAR', t('Saudi Riyal')],
        ['SEK', t('Swedish Krona')],
        ['SGD', t('Singapore Dollar')],
        ['THB', t('Thai Baht')],
        ['TRY', t('Turkish Lira')],
        ['TWD', t('New Taiwan Dollar')],
        ['TZS', t('Tanzanian Shilling')],
        ['UAH', t('Ukrainian Hryvnia')],
        ['USD', t('US Dollar')],
        ['UYU', t('Uruguayan Peso')],
        ['UZS', t('Uzbek Soum')],
        ['ZAR', t('South African Rand')],
      ]),
    [t],
  );

  return currencies.map(currency => {
    const translatedName =
      currencyTranslations.get(currency.code) ?? currency.name;
    if (currency.code === '') {
      return [currency.code, translatedName];
    }
    return [
      currency.code,
      `${currency.code} - ${translatedName} (${currency.symbol})`,
    ];
  });
}

/**
 * Select options for an account's currency. The empty code stands for the
 * main currency, so the account follows it when it changes.
 */
export function useAccountCurrencyOptions(): [string, string][] {
  const { t } = useTranslation();
  const currencyOptions = useCurrencyOptions();
  const mainCurrency = useMainCurrency();

  return [
    ['', t('Main currency ({{currency}})', { currency: mainCurrency ?? '' })],
    ...currencyOptions.filter(([code]) => code !== '' && code !== mainCurrency),
  ];
}
