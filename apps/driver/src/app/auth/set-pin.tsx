// "اختار رمزك" بعد موافقة المحل (SPEC-driver §2.5، التصميم ChangePin). بعد النجاح الجلسة تصل للحارس فيفتح التبويبات.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { FormMessage, PinField } from '../../components/AuthFields';
import { AuthLayout } from '../../components/AuthLayout';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ROUTES } from '../../features/auth/guard';
import { completeRegistration } from '../../features/auth/setPin';
import { forgetRegistration } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { loadRegistration, type Registration } from '../../lib/secureStore';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../theme';

const filled = (v: string) => v.replace(/\s/g, '').length === 6;

export default function SetPinScreen() {
  const [reg, setReg] = useState<Registration | null>(null);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadRegistration().then(async (saved) => {
      if (saved) setReg(saved);
      else {
        await forgetRegistration();
        router.replace(ROUTES.register);
      }
    });
  }, []);

  async function submit() {
    const client = getSupabase();
    if (!client || !reg || busy) return;
    setBusy(true);
    setError(null);
    const result = await completeRegistration(client, reg, pin, confirm);
    if (result.ok) return; // الحارس يوجّه للتبويبات
    if ('next' in result) {
      if (result.next === 'login') {
        router.replace({ pathname: ROUTES.login, params: { notice: 'ready' } });
      } else router.replace(result.next === 'pending' ? ROUTES.pending : ROUTES.register);
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (error) setError(null);
  };

  return (
    <AuthLayout
      footer={
        <PrimaryButton
          title={ar.setPin.submit}
          onPress={() => void submit()}
          disabled={!filled(pin) || !filled(confirm) || !reg}
          loading={busy}
          testID="set-pin-submit"
        />
      }
    >
      <View style={styles.approved}>
        <Ionicons name="checkmark" size={16} color={colors.primary} />
        <AppText size="small" weight="bold" color={colors.primary}>
          {ar.setPin.approved}
        </AppText>
      </View>
      <AppText accessibilityRole="header" weight="bold" size="display">
        {ar.setPin.title}
      </AppText>
      <AppText muted>{ar.setPin.hint}</AppText>
      <PinField
        label={ar.setPin.pin}
        value={pin}
        onChangeText={edit(setPin)}
        testID="set-pin-new"
        isNew
      />
      <PinField
        label={ar.setPin.confirm}
        value={confirm}
        onChangeText={edit(setConfirm)}
        testID="set-pin-confirm"
        isNew
      />
      <AppText size="small" muted>
        {ar.setPin.avoid}
      </AppText>
      {error ? <FormMessage text={error} /> : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  approved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    marginTop: 36,
  },
});
