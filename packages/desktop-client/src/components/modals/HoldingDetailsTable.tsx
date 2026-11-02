import type { ReactNode } from 'react';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

export function HoldingDetailsTable({
  columns,
  emptyMessage,
  children,
}: {
  columns: string[];
  emptyMessage?: string;
  children: ReactNode[];
}) {
  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          padding: '6px 10px',
          fontSize: 13,
          color: theme.tableHeaderText,
          backgroundColor: theme.tableHeaderBackground,
          borderBottom: `1px solid ${theme.tableBorder}`,
        }}
      >
        {columns.map((column, index) => (
          <Text key={column} style={cellStyle(index)}>
            {column}
          </Text>
        ))}
      </View>
      <View
        style={{
          maxHeight: 180,
          overflowY: 'auto',
          backgroundColor: theme.tableBackground,
        }}
      >
        {children.length === 0 && emptyMessage && (
          <Text
            style={{
              padding: '20px 10px',
              textAlign: 'center',
              color: theme.pageTextSubdued,
            }}
          >
            {emptyMessage}
          </Text>
        )}
        {children}
      </View>
    </View>
  );
}

// The first column holds the date, which needs a bit more room, and the rest
// share the width evenly. The widths ignore the content so rows line up.
export function cellStyle(index: number) {
  return {
    flex: index === 0 ? '1.5 1 0' : '1 1 0',
    minWidth: 0,
    textAlign: index === 0 ? ('left' as const) : ('right' as const),
    ...styles.tnum,
  };
}
