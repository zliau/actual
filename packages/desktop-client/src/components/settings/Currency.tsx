import React, { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { theme } from '@actual-app/components/theme';
import { getCurrency } from '@actual-app/core/shared/currencies';
import { css } from '@emotion/css';

import { Checkbox } from '#components/forms';
import { useCurrencyOptions } from '#hooks/useCurrencyOptions';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

export function CurrencySettings() {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const currencyOptions = useCurrencyOptions();

  const [defaultCurrencyCode, setDefaultCurrencyCodePref] = useSyncedPref(
    'defaultCurrencyCode',
  );
  const selectedCurrencyCode = defaultCurrencyCode || '';

  const [symbolPosition, setSymbolPositionPref] = useSyncedPref(
    'currencySymbolPosition',
  );
  const [spaceEnabled, setSpaceEnabledPref] = useSyncedPref(
    'currencySpaceBetweenAmountAndSymbol',
  );
  const [, setNumberFormatPref] = useSyncedPref('numberFormat');
  const [, setHideFractionPref] = useSyncedPref('hideFraction');

  const selectButtonClassName = css({
    '&[data-hovered]': {
      backgroundColor: theme.buttonNormalBackgroundHover,
    },
  });

  const handleCurrencyChange = (code: string) => {
    setDefaultCurrencyCodePref(code);
    if (code !== '') {
      const cur = getCurrency(code);
      setNumberFormatPref(cur.numberFormat);
      setHideFractionPref(cur.decimalPlaces === 0 ? 'true' : 'false');
      // A currency code used as the symbol (e.g. "CHF 100") needs a space
      const isSpaceEnabled = !cur.symbolFirst || cur.symbol === cur.code;
      setSpaceEnabledPref(isSpaceEnabled ? 'true' : 'false');
      setSymbolPositionPref(cur.symbolFirst ? 'before' : 'after');
    }
  };

  const symbolPositionOptions = useMemo(() => {
    const selectedCurrency = getCurrency(selectedCurrencyCode);
    const symbol = selectedCurrency.symbol || '$';
    const space = spaceEnabled === 'true' ? ' ' : '';

    return [
      {
        value: 'before',
        label: `${t('Before amount')} (${t('e.g.')} ${symbol}${space}100)`,
      },
      {
        value: 'after',
        label: `${t('After amount')} (${t('e.g.')} 100${space}${symbol})`,
      },
    ];
  }, [selectedCurrencyCode, spaceEnabled, t]);

  return (
    <SettingsGroup
      title={t('Currency')}
      description={t(
        'Currency settings affect how amounts are displayed throughout the application. Changing the currency also updates the number format, symbol position and whether decimal places are shown. These can be adjusted after the currency is set.',
      )}
    >
      <SettingsRow
        title={t('Default currency')}
        control={
          <Select
            value={selectedCurrencyCode}
            onChange={handleCurrencyChange}
            options={currencyOptions}
            className={selectButtonClassName}
            style={{ maxWidth: '100%' }}
          />
        }
      />
      {selectedCurrencyCode !== '' && (
        <SettingsRow
          title={t('Symbol position')}
          control={
            <Select
              value={symbolPosition || 'before'}
              onChange={value => setSymbolPositionPref(value)}
              options={symbolPositionOptions.map(f => [f.value, f.label])}
              className={selectButtonClassName}
              style={{ maxWidth: '100%' }}
            />
          }
        />
      )}
      {selectedCurrencyCode !== '' && (
        <SettingsRow
          htmlFor="settings-spaceEnabled"
          title={t('Add space between amount and symbol')}
          control={
            <Checkbox
              id="settings-spaceEnabled"
              checked={spaceEnabled === 'true'}
              onChange={e =>
                setSpaceEnabledPref(e.target.checked ? 'true' : 'false')
              }
              style={{ marginRight: 0 }}
            />
          }
        />
      )}
      {selectedCurrencyCode !== '' && (
        <SettingsRow
          title={t('Exchange rates')}
          description={t(
            'Accounts can use another currency than the default one. Their amounts are converted to the default currency with these rates.',
          )}
          control={
            <Button
              onPress={() =>
                dispatch(
                  pushModal({ modal: { name: 'exchange-rates', options: {} } }),
                )
              }
            >
              <Trans>Manage exchange rates</Trans>
            </Button>
          }
        />
      )}
    </SettingsGroup>
  );
}
