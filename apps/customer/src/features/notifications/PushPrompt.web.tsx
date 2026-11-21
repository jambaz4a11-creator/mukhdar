// بطاقة تمهيد إشعارات الويب للزبون (T38، SPEC-webpush §5.6/§5.7): تظهر بصفحة الطلب بعد نجاح الطلب (لحظة القيمة)، لا
// عند فتح التطبيق ولا الدخول. الزر وحده يستدعي Notification.requestPermission() (لمسة مستخدم).
//   default ← [فعّل الإشعارات] [مو هسه] ("مو هسه" تخفيها 7 أيام)؛ needs-install (iOS خارج الـ PWA) ← دليل التثبيت؛
//   denied ← شريط "الإشعارات مطفية" مع طريقة التفعيل؛ غير ذلك ← لا شيء.
import type { WebPushState } from '@mukhdar/shared';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';
import { registerPushToken } from './push';
import { getWebPush, needsInstall } from './webPushController';

export function PushPrompt() {
  const [state, setState] = useState<WebPushState | null>(null);
  const [snoozed, setSnoozed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const wp = getWebPush();
    const [s, z] = await Promise.all([wp.getState(needsInstall()), wp.isSnoozed()]);
    setState(s);
    setSnoozed(z);
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function onEnable() {
    const client = getSupabase();
    if (!client || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await registerPushToken(client, { ask: true });
      setFailed(result === 'failed' || result === 'unsupported');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onLater() {
    setSnoozed(true);
    await getWebPush().snooze();
  }

  const laterButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ar.notifications.later}
      onPress={() => void onLater()}
      testID="push-later"
      style={styles.later}
    >
      <AppText muted>{ar.notifications.later}</AppText>
    </Pressable>
  );

  if (state === 'denied') {
    return (
      <View style={styles.warn} testID="push-denied-banner">
        <AppText size="small" color={colors.warningText}>
          {ar.notifications.deniedBanner}
        </AppText>
        <AppText size="small" color={colors.warningText}>
          {ar.notifications.deniedHow}
        </AppText>
      </View>
    );
  }

  if (state === 'needs-install' && !snoozed) {
    return (
      <View style={styles.card} testID="push-install-card">
        <AppText>{ar.notifications.needsInstall}</AppText>
        <AppText size="small" muted>
          {ar.notifications.installSteps}
        </AppText>
        {laterButton}
      </View>
    );
  }

  if (state === 'default' && !snoozed) {
    return (
      <View style={styles.card} testID="push-prompt">
        <AppText>{ar.notifications.promptBody}</AppText>
        {failed ? (
          <AppText size="small" color={colors.danger} testID="push-enable-failed">
            {ar.notifications.enableFailed}
          </AppText>
        ) : null}
        <PrimaryButton
          title={ar.notifications.enable}
          loading={busy}
          onPress={() => void onEnable()}
          testID="push-enable"
        />
        {laterButton}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  warn: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.warningSoft,
    gap: spacing.xs,
  },
  later: { alignItems: 'center', paddingVertical: spacing.sm },
});
