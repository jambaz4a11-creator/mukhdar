import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components/AppText';
import { Placeholder } from '../../components/Screen';
import { ar } from '../../i18n/ar';
import { captureError, isSentryEnabled } from '../../lib/sentry';
import { colors, radius, sizes, spacing } from '../../theme';

export default function AccountScreen() {
  const [sent, setSent] = useState(false);
  return (
    <Placeholder>
      <AppText weight="semibold" size="title">
        {ar.placeholders.account}
      </AppText>
      <AppText muted>{ar.placeholders.soon}</AppText>
      {/* اختبار T09 اليدوي: خطأ متعمد يصل لـ Sentry. يظهر فقط بالتطوير ومع DSN مضبوط. */}
      {__DEV__ && isSentryEnabled() ? (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            captureError(new Error('Sentry test error (T09, manual)'));
            setSent(true);
          }}
        >
          <AppText weight="medium" color={colors.danger}>
            {sent ? ar.dev.sentrySent : ar.dev.sentryTest}
          </AppText>
        </Pressable>
      ) : null}
    </Placeholder>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: sizes.touchTarget,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
  },
});
