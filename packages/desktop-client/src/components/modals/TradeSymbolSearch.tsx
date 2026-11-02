import { useState } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  SecurityExchange,
  SecuritySearchResult,
} from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import { getSecurityProviderMessage, investmentQueries } from '#investments';

type TradeSymbolSearchProps = {
  exchange: SecurityExchange;
  query: string;
  onSelect: (result: SecuritySearchResult) => void;
};

// Searches only when asked, since each search uses up part of a small daily
// allowance on some exchanges. Symbols can always be typed in instead.
export function TradeSymbolSearch({
  exchange,
  query,
  onSelect,
}: TradeSymbolSearchProps) {
  const isOnline = useSyncServerStatus() === 'online';
  const { data: status } = useQuery({
    ...investmentQueries.priceStatus(),
    enabled: isOnline,
  });
  const [results, setResults] = useState<SecuritySearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOnline || !status || 'error' in status || !status[exchange]) {
    return null;
  }

  const onSearch = async () => {
    setIsSearching(true);
    setError(null);
    setResults(null);
    const response = await send('securities-search', { exchange, query });
    setIsSearching(false);
    if ('error' in response) {
      setError(getSecurityProviderMessage(response.error));
    } else {
      setResults(response.results);
    }
  };

  return (
    <View style={{ marginLeft: 75, marginBottom: 5, gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button
          isDisabled={isSearching || query.trim() === ''}
          onPress={() => void onSearch()}
        >
          {isSearching ? (
            <AnimatedLoading style={{ width: 16, height: 16 }} />
          ) : (
            <Trans>Find symbol</Trans>
          )}
        </Button>
        {error && (
          <Text style={{ color: theme.errorText, fontSize: 13 }}>{error}</Text>
        )}
        {results?.length === 0 && (
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Nothing found.</Trans>
          </Text>
        )}
      </View>
      {results && results.length > 0 && (
        <View
          style={{
            maxHeight: 150,
            overflowY: 'auto',
            border: `1px solid ${theme.tableBorder}`,
            borderRadius: 4,
            backgroundColor: theme.tableBackground,
          }}
        >
          {results.map(result => (
            <Button
              key={result.symbol}
              variant="bare"
              onPress={() => {
                onSelect(result);
                setResults(null);
              }}
              style={{
                justifyContent: 'flex-start',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 0,
                color: theme.tableText,
              }}
            >
              <Text style={{ fontWeight: 500 }}>{result.symbol}</Text>
              <Text
                style={{
                  color: theme.pageTextLight,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {result.name}
              </Text>
            </Button>
          ))}
        </View>
      )}
    </View>
  );
}
