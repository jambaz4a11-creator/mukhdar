// زر ثانوي (أبيض بحد، نفس ارتفاع الرئيسي 56): "تحقق من الموافقة"، "اتصل بالمحل"، "تحديث".
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

interface Props {
  title: string;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function SecondaryButton({
  title,
  onPress,
  icon,
  loading = false,
  disabled,
  testID,
}: Props) {
  const inactive = disabled === true || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={colors.primary} /> : null}
          <AppText weight="bold">{title}</AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: sizes.primaryButton,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pressed: { backgroundColor: colors.primarySoft },
});
