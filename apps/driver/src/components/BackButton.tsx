// زر الرجوع (التصميم: مربع 44 بحد، سهم لليمين بـ RTL). بلا سجل رجوع ← fallback.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, sizes, spacing } from '../theme';

export function BackButton({ label, fallback }: { label: string; fallback: string }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        style={styles.back}
        testID="back"
      >
        <Ionicons name="chevron-forward" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, alignItems: 'flex-start' },
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
