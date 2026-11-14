// عداد الكمية "+ الكمية -": كل ضغطة = وحدة بيع واحدة، والعرض بـ formatQuantity ("نص كيلو"، "1 كيلو"، "3 باقة").
// بالـ RTL أول عنصر (+) يظهر يميناً كما بالتصميم.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatQuantity } from '@mukhdar/shared';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ar } from '../i18n/ar';
import { colors, radius, sizes } from '../theme';
import { AppText } from './AppText';

interface Props {
  qty: number;
  unit: string;
  onIncrement: () => void;
  onDecrement: () => void;
  canIncrement?: boolean;
  canDecrement?: boolean;
  /** compact: داخل البطاقة (ارتفاع 44)؛ large: شاشة المنتج (52) */
  variant?: 'compact' | 'large';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function QuantityStepper({
  qty,
  unit,
  onIncrement,
  onDecrement,
  canIncrement = true,
  canDecrement = true,
  variant = 'compact',
  style,
  testID,
}: Props) {
  const large = variant === 'large';
  const btn = large ? 52 : sizes.touchTarget;
  const label = formatQuantity(qty, unit);

  return (
    <View
      testID={testID}
      style={[styles.box, large ? styles.large : styles.compact, { height: btn }, style]}
    >
      <StepButton
        icon="add"
        label={ar.catalog.increase}
        size={btn}
        disabled={!canIncrement}
        onPress={onIncrement}
      />
      <AppText
        weight="bold"
        size={large ? 'body' : 'small'}
        color={large ? colors.text : colors.primary}
        style={[styles.label, large && styles.labelLarge]}
        accessibilityLiveRegion="polite"
        numberOfLines={1}
      >
        {label}
      </AppText>
      <StepButton
        icon="remove"
        label={ar.catalog.decrease}
        size={btn}
        disabled={!canDecrement}
        onPress={onDecrement}
      />
    </View>
  );
}

function StepButton({
  icon,
  label,
  size,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  size: number;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.btn,
        { width: size, height: size },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compact: { backgroundColor: colors.primarySoft, borderRadius: radius.control },
  large: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  btn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.control },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
  label: { flexShrink: 1, textAlign: 'center' },
  labelLarge: { minWidth: 84 },
});
