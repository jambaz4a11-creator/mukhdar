// بطاقة تمهيد إشعارات الويب للسائق (T38، SPEC-webpush §5.6). لا طلب إذن عند التحميل ولا عند الدخول: الزر وحده يستدعي
// Notification.requestPermission() (لمسة مستخدم). الحالات (webPushState):
//   default ← بطاقة [فعّل الإشعارات] [مو هسه] ("مو هسه" تخفيها 7 أيام)
//   needs-install (iOS خارج الـ PWA) ← دليل التثبيت بدل الزر
//   denied ← شريط "الإشعارات مطفية" مع طريقة التفعيل (لا إعادة طلب: المتصفح لا يسمح)
//   غير ذلك ← لا شيء (التسجيل الصامت بـ NotificationsBridge.web)
import type { WebPushState } from '@mukhdar/shared';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ar } from '../../i18n/ar';
import { registerPushToken } from '../../lib/push';
import { getSupabase } from '../../lib/supabase';
import { getWebPush } from '../../lib/webPushController';
import { colors, radius, spacing } from '../../theme';
import { installState } from '../install/installState';
import { readInstallEnv } from '../install/useInstallState';

interface BrowserWindow {
  navigator?: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
}

function needsInstall(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    installState(readInstallEnv('web', window as unknown as BrowserWindow, false)) === 'ios-browser'
  );
}

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

  if (state === 'denied') {
    return (
      <View style={styles.warn} testID="push-denied-banner">
        <AppText size="small" color={colors.warningText}>
          {ar.push.offBanner}
        </AppText>
        <AppText size="small" color={colors.warningText}>
          {ar.push.deniedHow}
        </AppText>
      </View>
    );
  }

  if (state === 'needs-install' && !snoozed) {
    return (
      <View style={styles.card} testID="push-install-card">
        <AppText>{ar.push.needsInstall}</AppText>
        <AppText size="small" muted>
          {ar.install.iosStep1} ← {ar.install.iosStep2} ← {ar.install.iosStep3}
        </AppText>
        <SecondaryButton title={ar.push.later} onPress={() => void onLater()} testID="push-later" />
      </View>
    );
  }

  if (state === 'default' && !snoozed) {
    return (
      <View style={styles.card} testID="push-prompt">
        <AppText>{ar.push.promptBody}</AppText>
        {failed ? (
          <AppText size="small" color={colors.danger} testID="push-enable-failed">
            {ar.push.enableFailed}
          </AppText>
        ) : null}
        <PrimaryButton
          title={ar.push.enable}
          loading={busy}
          onPress={() => void onEnable()}
          testID="push-enable"
        />
        <SecondaryButton title={ar.push.later} onPress={() => void onLater()} testID="push-later" />
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
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.warningSoft,
    gap: spacing.xs,
  },
});
