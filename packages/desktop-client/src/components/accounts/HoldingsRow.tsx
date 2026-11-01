import type { CSSProperties, ReactNode } from 'react';

import { View } from '@actual-app/components/view';

export function HoldingsRow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: '6px 10px',
        ...style,
      }}
    >
      {children}
    </View>
  );
}
