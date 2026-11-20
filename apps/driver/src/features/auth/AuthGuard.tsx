// حارس الجذر (SPEC-driver §2.1): يُركَّب مرة فوق التنقل. عند أي تغيّر بالحالة أو المسار يوجّه بـ router.replace،
// ويغطي الشاشة بمؤشر تحميل ما دمنا لا نعرف الوجهة (قبل قراءة الجلسة/الملف الشخصي).
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ar } from '../../i18n/ar';
import { colors } from '../../theme';
import { guardRedirect, isGuardBlocking } from './guard';
import { useAuth } from './store';

export function AuthGuard() {
  const state = useAuth();
  const pathname = usePathname();
  const navReady = Boolean(useRootNavigationState()?.key);
  const target = guardRedirect(state, pathname);

  useEffect(() => {
    if (navReady && target) router.replace(target);
  }, [navReady, target]);

  if (!isGuardBlocking(state) && !target) return null;
  return (
    <View
      style={styles.overlay}
      testID="guard-loading"
      accessibilityLabel={ar.common.loading}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
