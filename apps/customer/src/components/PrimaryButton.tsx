// الزر الرئيسي (ارتفاع 56، زاوية 16، لون primary). معطّل = باهت ولا يستجيب.
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { colors, radius, sizes } from '../theme';
import { AppText } from './AppText';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.surface} />
      ) : (
        <AppText weight="bold" color={colors.surface} style={styles.label}>
          {title}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: sizes.primaryButton,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.primaryPressed },
  inactive: { opacity: 0.45 },
  label: { textAlign: 'center' },
});
