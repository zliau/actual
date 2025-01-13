// @ts-strict-ignore
import React, { type ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { css } from '@emotion/css';

import { type SyncedPrefs } from 'loot-core/src/types/prefs';

import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useSyncedPref } from '../../hooks/useSyncedPref';
import { theme } from '../../style';
import { tokens } from '../../tokens';
import { Select } from '../common/Select';
import { Text } from '../common/Text';
import { View } from '../common/View';
import { useSidebar } from '../sidebar/SidebarProvider';

import { Setting } from './UI';

const currencies: { value: SyncedPrefs['currency']; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'CAD', label: 'CAD' },
];

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View
      style={{
        alignItems: 'flex-start',
        flexGrow: 1,
        gap: '0.5em',
        width: '100%',
      }}
    >
      <Text style={{ fontWeight: 500 }}>{title}</Text>
      <View style={{ alignItems: 'flex-start', gap: '1em' }}>{children}</View>
    </View>
  );
}

export function CurrencySettings() {
  const { t } = useTranslation();

  const sidebar = useSidebar();
  const multiCurrencyFeatureFlag = useFeatureFlag('multiCurrency');
  const [_currencyPref, setCurrencyPref] = useSyncedPref('currency');
  const currencyPref = _currencyPref || 'USD';

  const selectButtonClassName = css({
    '&[data-hovered]': {
      backgroundColor: theme.buttonNormalBackgroundHover,
    },
  });

  return (
    multiCurrencyFeatureFlag && (
      <Setting
        primaryAction={
          <View
            style={{
              flexDirection: 'column',
              gap: '1em',
              width: '100%',
              [`@media (min-width: ${
                sidebar.floating
                  ? tokens.breakpoint_small
                  : tokens.breakpoint_medium
              })`]: {
                flexDirection: 'row',
              },
            }}
          >
            <Column title={t('Currency')}>
              <Select
                onChange={value => setCurrencyPref(value)}
                value={currencyPref}
                options={currencies.map(c => [c.value, c.label])}
                className={selectButtonClassName}
              />
            </Column>
          </View>
        }
      >
        <Text>
          <Trans>Select your default currency for this budget.</Trans>
        </Text>
      </Setting>
    )
  );
}
