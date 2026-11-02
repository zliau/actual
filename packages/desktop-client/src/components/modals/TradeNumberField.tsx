import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

export function TradeNumberField({
  label,
  name,
  value,
  suffix,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <InlineField label={label} width="100%">
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
        <Input
          name={name}
          inputMode="decimal"
          aria-label={label}
          value={value}
          onChangeValue={onChange}
          style={{ flex: 1, minWidth: 0, textAlign: 'right', ...styles.tnum }}
        />
        {suffix && (
          <Text style={{ marginLeft: 8, flexShrink: 0 }}>{suffix}</Text>
        )}
      </View>
    </InlineField>
  );
}
