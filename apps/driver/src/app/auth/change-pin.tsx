// تغيير الرمز المؤقت الإجباري (DRIVER-API §2.3، ADR 0001): بعد admin-reset-pin أو admin-create-user
// (profiles.must_change_pin). بلا تخطٍ ولا رجوع، فقط "تسجيل الخروج". changePin من @mukhdar/shared:
// signInWithPassword بالمؤقت ← validatePin والجديد ≠ المؤقت ← updateUser ← signOut({scope:'others'}).
// قاعدة البيانات تمسح العلامة بنفسها؛ نعيد قراءة الملف الشخصي فيفتح الحارس التبويبات.
import { changePin } from '@mukhdar/shared';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { FormMessage, PinField } from '../../components/AuthFields';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { refreshProfile, signOut, useAuth } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { sizes, spacing } from '../../theme';

const filled = (v: string) => v.replace(/\s/g, '').length === 6;

export default function ChangePinScreen() {
  const session = useAuth((s) => s.session);
  const profilePhone = useAuth((s) => s.profile?.phone);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // زر الرجوع بأندرويد لا يفعل شيئاً (الحارس يعيدنا هنا على أي حال)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  async function submit() {
    const client = getSupabase();
    if (!client || !session || busy) return;
    setBusy(true);
    setError(null);
    const phone = session.user.phone ?? profilePhone ?? '';
    const result = await changePin(client, phone, current, next, confirm);
    if (result.ok) {
      await refreshProfile(client);
      setBusy(false);
      return;
    }
    if (result.field === 'current') setCurrent('');
    setError(result.message);
    setBusy(false);
  }

  async function leave() {
    const client = getSupabase();
    if (client) await signOut(client);
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (error) setError(null);
  };

  return (
    <AuthLayout
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.changePin.submit}
            onPress={() => void submit()}
            disabled={!filled(current) || !filled(next) || !filled(confirm)}
            loading={busy}
            testID="pin-submit"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void leave()}
            style={styles.signOut}
            testID="pin-sign-out"
          >
            <AppText muted>{ar.common.signOut}</AppText>
          </Pressable>
        </View>
      }
    >
      <AppText accessibilityRole="header" weight="bold" size="display" style={styles.title}>
        {ar.changePin.title}
      </AppText>
      <AppText muted>{ar.changePin.hint}</AppText>
      <PinField
        label={ar.changePin.current}
        value={current}
        onChangeText={edit(setCurrent)}
        testID="pin-current"
      />
      <PinField
        label={ar.changePin.next}
        value={next}
        onChangeText={edit(setNext)}
        testID="pin-new"
        isNew
      />
      <PinField
        label={ar.changePin.confirm}
        value={confirm}
        onChangeText={edit(setConfirm)}
        testID="pin-confirm"
        isNew
      />
      {error ? <FormMessage text={error} /> : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 36 },
  footer: { gap: spacing.xs },
  signOut: { minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
