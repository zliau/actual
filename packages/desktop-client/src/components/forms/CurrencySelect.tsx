import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Select } from '@actual-app/components/select';

import { currencies, getCurrency } from 'loot-core/shared/currencies';

import { useFeatureFlag } from '@desktop-client/hooks/useFeatureFlag';

type CurrencySelectProps = {
  value: string;
  onUpdate: (value: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
};

export function CurrencySelect({
  value,
  onUpdate,
  disabled = false,
  style,
}: CurrencySelectProps) {
  const { t } = useTranslation();
  const multiCurrencyEnabled = useFeatureFlag('multiCurrency');

  const currencyOptions: [string, string][] = currencies.map(currency => [
    currency.code,
    currency.code === ''
      ? t('Default')
      : `${currency.code} - ${currency.name} (${currency.symbol})`,
  ]);

  const handleSelect = useCallback(
    (newValue: string) => {
      onUpdate(newValue);
    },
    [onUpdate],
  );

  if (!multiCurrencyEnabled) {
    return null;
  }

  return (
    <Select
      value={value}
      onChange={handleSelect}
      options={currencyOptions}
      disabled={disabled}
      style={style}
    />
  );
} 