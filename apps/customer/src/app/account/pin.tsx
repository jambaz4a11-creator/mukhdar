// تغيير رمز الدخول (T15، ADR 0001): الحالي (يُتحقق منه بـ signInWithPassword) ثم الجديد مرتين ← validatePin ←
// updateUser بأرقام لاتينية. مفيد بعد إعادة الضبط من الأدمن. محمية بالدخول.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { FormMessage, PinField } from '../../components/AuthFields';
import { BackHeader } from '../../components/BackHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { changePin } from '../../features/account/api';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, spacing } from '../../theme';

const filled = (v: string) => v.replace(/\s/g, '').length === 6;

type Message = { text: string; tone: 'error' | 'info' };

export default function ChangePinScreen() {
  const session = useRequireAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  if (!session) return null;

  async function submit() {
    const client = getSupabase();
    if (!client || !session || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await changePin(client, session.user.phone ?? '', current, next, confirm);
    if (result.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ text: ar.account.pinChanged, tone: 'info' });
    } else {
      if (result.field === 'current') setCurrent('');
      setMessage({ text: result.message, tone: 'error' });
    }
    setBusy(false);
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (message?.tone === 'error') setMessage(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <BackHeader title={ar.account.pinTitle} backLabel={ar.account.back} fallback="/account" />
        <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
          <AppText muted>{ar.account.pinHint}</AppText>
          <PinField
            label={ar.account.pinCurrent}
            value={current}
            onChangeText={edit(setCurrent)}
            testID="pin-current"
          />
          <PinField
            label={ar.account.pinNew}
            value={next}
            onChangeText={edit(setNext)}
            testID="pin-new"
            isNew
          />
          <PinField
            label={ar.account.pinConfirm}
            value={confirm}
            onChangeText={edit(setConfirm)}
            testID="pin-confirm"
            isNew
          />
          {message ? <FormMessage text={message.text} tone={message.tone} /> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.account.pinSave}
            onPress={() => void submit()}
            disabled={!filled(current) || !filled(next) || !filled(confirm)}
            loading={busy}
            testID="pin-submit"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  main: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, gap: spacing.lg },
  footer: { padding: spacing.lg, paddingBottom: spacing.lg + 8 },
});
