// تغيير الرمز السري من حسابي (SPEC-driver §2.10، ADR 0001): الحالي + الجديد + التأكيد. changePin من @mukhdar/shared:
// signInWithPassword بالحالي ← validatePin والجديد ≠ الحالي ← updateUser ← signOut({scope:'others'}) (باقي الأجهزة تخرج).
import { changePin } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { FormMessage, PinField } from '../../components/AuthFields';
import { BackButton } from '../../components/BackButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, spacing } from '../../theme';

const filled = (v: string) => v.replace(/\s/g, '').length === 6;

export default function AccountChangePinScreen() {
  const session = useAuth((s) => s.session);
  const profilePhone = useAuth((s) => s.profile?.phone);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const client = getSupabase();
    if (!client || !session || busy) return;
    setBusy(true);
    setError(null);
    const phone = session.user.phone ?? profilePhone ?? '';
    const result = await changePin(client, phone, current, next, confirm);
    setBusy(false);
    if (result.ok) {
      router.back();
      return;
    }
    if (result.field === 'current') setCurrent('');
    setError(result.message);
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (error) setError(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <BackButton label={ar.account.changePin} fallback="/account" />
      <View style={styles.content}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.account.changePinTitle}
        </AppText>
        <AppText muted size="small">
          {ar.account.changePinHint}
        </AppText>
        <PinField
          label={ar.account.changePinCurrent}
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
        <PrimaryButton
          title={ar.changePin.submit}
          onPress={() => void submit()}
          disabled={!filled(current) || !filled(next) || !filled(confirm)}
          loading={busy}
          testID="pin-submit"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.screen, gap: spacing.lg },
});
