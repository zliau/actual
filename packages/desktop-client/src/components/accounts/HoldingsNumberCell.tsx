import type { CSSProperties, ReactNode } from 'react';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';

export function HoldingsNumberCell({
  width,
  style,
  children,
}: {
  width: number;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Text
      style={{
        width,
        flexShrink: 0,
        textAlign: 'right',
        ...styles.tnum,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
