// تسجيل سائق جديد (SPEC-driver §2.3، التصميم Register): الاسم والرقم ← طلب معلّق بلا أي حساب ← Pending.
import { normalizeIraqiPhone } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText } from '../../components/AppText';
import { FormMessage, NameField, PhoneField } from '../../components/AuthFields';
import { AuthLayout } from '../../components/AuthLayout';
import { BackButton } from '../../components/BackButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ROUTES } from '../../features/auth/guard';
import { submitRegistration } from '../../features/auth/register';
import { refreshRegistration } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSubmit = name.trim() !== '' && normalizeIraqiPhone(phone) !== null;

  async function submit() {
    if (!canSubmit || busy) return;
    const client = getSupabase();
    if (!client) {
      setError(ar.common.notConfigured);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitRegistration(client, { fullName: name, phone });
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    // الحارس يسمح بـ Pending بعد أن يعرف أن الطلب محفوظ
    await refreshRegistration();
    router.replace(ROUTES.pending);
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (error) setError(null);
  };

  return (
    <AuthLayout
      top={<BackButton label={ar.register.back} fallback={ROUTES.login} />}
      footer={
        <PrimaryButton
          title={ar.register.submit}
          onPress={() => void submit()}
          disabled={!canSubmit}
          loading={busy}
          testID="register-submit"
        />
      }
    >
      <AppText accessibilityRole="header" weight="bold" size="display">
        {ar.register.title}
      </AppText>
      <AppText muted>{ar.register.hint}</AppText>
      <NameField value={name} onChangeText={edit(setName)} />
      <PhoneField value={phone} onChangeText={edit(setPhone)} />
      <AppText size="small" muted>
        {ar.register.pushHint}
      </AppText>
      {error ? <FormMessage text={error} /> : null}
    </AuthLayout>
  );
}
