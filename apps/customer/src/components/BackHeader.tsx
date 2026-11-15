// رأس شاشة فرعية: زر رجوع (سهم لليمين بـ RTL) + العنوان. بلا سجل رجوع ← fallback.
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export function BackHeader({
  title,
  backLabel,
  fallback,
}: {
  title: string;
  backLabel: string;
  fallback: Href;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        style={styles.back}
        testID="back"
      >
        <Ionicons name="chevron-forward" size={22} color={colors.text} />
      </Pressable>
      <AppText accessibilityRole="header" weight="bold" size="title">
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
