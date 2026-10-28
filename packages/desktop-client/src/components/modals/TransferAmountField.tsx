import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type TransferAmountFieldProps = {
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
};

export function TransferAmountField({
  label,
  currency,
  value,
  onChange,
  autoFocus,
}: TransferAmountFieldProps) {
  const input = (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={value}
      onChangeValue={onChange}
      style={{ flex: 1, textAlign: 'right', ...styles.tnum }}
    />
  );

  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontWeight: 500 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {autoFocus ? <InitialFocus>{input}</InitialFocus> : input}
        <Text style={{ width: 36, color: theme.pageTextSubdued }}>
          {currency}
        </Text>
      </View>
    </View>
  );
}
