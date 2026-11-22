// R3 M4 (SPEC-webpush §6.3): بلا IndexedDB أو WebCrypto (وضع التصفح الخاص، حظر التخزين) يعمل التخزين المشفَّر بالذاكرة
// فقط، فتضيع الجلسة (وبالسائق سر طلب التسجيل) عند إغلاق التبويب. هذا الشريط يقول ذلك بوضوح بدل الضياع الصامت.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ar } from '../i18n/ar';
import { secureStorage } from '../lib/secureStorage.web';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export function StorageWarning() {
  const [degraded, setDegraded] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    void secureStorage
      .ready()
      .then((r) => {
        if (alive) setDegraded(r.degraded);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!degraded) return null;
  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + spacing.sm }]}
      accessibilityRole="alert"
      testID="storage-degraded-banner"
    >
      <AppText size="small" weight="medium" color={colors.warningText}>
        {ar.storage.degraded}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.warningSoft,
  },
});
