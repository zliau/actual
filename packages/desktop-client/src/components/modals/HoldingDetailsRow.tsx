import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';

import { cellStyle } from './HoldingDetailsTable';

export function HoldingDetailsRow({
  label,
  cells,
  isDisabled,
  onPress,
}: {
  label: string;
  cells: string[];
  isDisabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="bare"
      aria-label={label}
      isDisabled={isDisabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        justifyContent: 'flex-start',
        padding: '6px 10px',
        borderRadius: 0,
        color: theme.tableText,
        borderBottom: `1px solid ${theme.tableBorder}`,
      }}
    >
      {cells.map((cell, index) => (
        <Text key={index} style={cellStyle(index)}>
          {cell}
        </Text>
      ))}
    </Button>
  );
}
