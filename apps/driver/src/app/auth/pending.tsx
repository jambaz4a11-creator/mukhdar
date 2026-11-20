// بانتظار الموافقة (SPEC-driver §2.4، التصميم Pending): الاسم والرقم المحفوظان، الشارة، "تحقق من الموافقة".
// الاستطلاع: عند الفتح، كل 30 ثانية والشاشة ظاهرة، عند الرجوع للتطبيق، وبالزر. approved ← set-pin؛
// rejected/expired ← حالة نهائية بزر "طلب جديد"؛ completed ← Login؛ not_found ← Register.
import Ionicons from '@expo/vector-icons/Ionicons';
import { displayPhone, parseBackendError } from '@mukhdar/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { FormMessage } from '../../components/AuthFields';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ShopContact } from '../../components/ShopContact';
import { ROUTES } from '../../features/auth/guard';
import {
  fetchRequestStatus,
  pendingOutcome,
  startPendingPoll,
} from '../../features/auth/pendingPoll';
import { forgetRegistration } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { loadRegistration, type Registration } from '../../lib/secureStore';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

type Final = 'rejected' | 'expired';

export default function PendingScreen() {
  const [reg, setReg] = useState<Registration | null>(null);
  const [final, setFinal] = useState<Final | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    void loadRegistration().then(setReg);
  }, []);

  const check = useCallback(async () => {
    const client = getSupabase();
    if (inFlight.current || done.current) return;
    if (!client) {
      setError(ar.common.notConfigured);
      return;
    }
    inFlight.current = true;
    setChecking(true);
    try {
      const saved = await loadRegistration();
      if (!saved) {
        done.current = true;
        await forgetRegistration();
        router.replace(ROUTES.register);
        return;
      }
      const outcome = pendingOutcome(await fetchRequestStatus(client, saved));
      if (outcome === null) throw new Error('unknown status');
      setError(null);
      if (outcome === 'pending') return;
      if (outcome === 'rejected' || outcome === 'expired') {
        done.current = true;
        setFinal(outcome);
        return;
      }
      done.current = true;
      if (outcome === 'set-pin') {
        router.replace(ROUTES.setPin);
        return;
      }
      await forgetRegistration();
      if (outcome === 'login') {
        router.replace({ pathname: ROUTES.login, params: { notice: 'ready' } });
      } else router.replace(ROUTES.register);
    } catch (e) {
      setError(parseBackendError(e).message);
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  // الاستطلاع ما دامت الشاشة ظاهرة (يتوقف عند الاختفاء وبالخلفية)
  useFocusEffect(useCallback(() => startPendingPoll(() => void check()), [check]));

  async function startOver() {
    done.current = true;
    await forgetRegistration();
    router.replace(ROUTES.register);
  }

  if (final) {
    return (
      <AuthLayout
        footer={
          <PrimaryButton
            title={ar.pending.newRequest}
            onPress={() => void startOver()}
            testID="pending-new"
          />
        }
      >
        <View style={styles.hero}>
          <View style={[styles.icon, styles.iconDanger]}>
            <Ionicons name="close-circle-outline" size={48} color={colors.danger} />
          </View>
          <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
            {final === 'rejected' ? ar.pending.rejectedTitle : ar.pending.expiredTitle}
          </AppText>
          <AppText muted style={styles.center}>
            {final === 'rejected' ? ar.pending.rejectedBody : ar.pending.expiredBody}
          </AppText>
        </View>
        {final === 'rejected' ? <ShopContact /> : null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={
        <View style={styles.footer}>
          <SecondaryButton
            title={ar.pending.check}
            onPress={() => void check()}
            loading={checking}
            testID="pending-check"
          />
          <AppText size="caption" muted style={styles.center}>
            {ar.pending.auto}
          </AppText>
          <Pressable
            accessibilityRole="link"
            onPress={() => void startOver()}
            style={styles.cancel}
            testID="pending-cancel"
          >
            <AppText size="small" color={colors.primary} weight="semibold">
              {ar.pending.cancel}
            </AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.hero}>
        <View style={[styles.icon, styles.iconWarning]}>
          <Ionicons name="time-outline" size={48} color={colors.warningText} />
        </View>
        <AppText accessibilityRole="header" weight="bold" size="heading" style={styles.center}>
          {ar.pending.title}
        </AppText>
        {reg ? (
          <View style={styles.who}>
            <AppText muted>{reg.fullName}</AppText>
            <AppText muted>·</AppText>
            <AppText muted style={styles.ltr}>
              {displayPhone(reg.phone)}
            </AppText>
          </View>
        ) : null}
        <AppText muted style={styles.center}>
          {ar.pending.body}
        </AppText>
        <View style={styles.badge}>
          <View style={styles.dot} />
          <AppText size="small" weight="bold" color={colors.warningText}>
            {ar.pending.badge}
          </AppText>
        </View>
      </View>
      {error ? <FormMessage text={error} /> : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.lg, paddingTop: 72 },
  icon: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWarning: { backgroundColor: colors.warningSoft },
  iconDanger: { backgroundColor: colors.dangerSoft },
  center: { textAlign: 'center', lineHeight: 28 },
  who: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  ltr: { writingDirection: 'ltr' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.warningSoft,
    marginTop: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.warningText },
  footer: { gap: spacing.xs },
  cancel: { minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
