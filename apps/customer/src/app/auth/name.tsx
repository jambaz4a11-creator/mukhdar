// الاسم أول مرة (T10، تصميم Name): يُحفظ بـ profiles.full_name، ثم إضافة أول عنوان إن لم يوجد (T12)،
// ثم الرجوع لمكان المستخدم.
import { errorMessage } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { FieldLabel, FormMessage } from '../../components/AuthFields';
import { PrimaryButton } from '../../components/PrimaryButton';
import { hasAnyAddress } from '../../features/addresses/api';
import { NEW_ADDRESS, safeRedirect } from '../../features/auth/redirect';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../../theme';

const NAME_MAX = 80;

export default function NameScreen() {
  const session = useRequireAuth();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const redirect = safeRedirect(params.redirect);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim().replace(/\s+/g, ' ');

  async function save() {
    const client = getSupabase();
    if (!client || !session || trimmed.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const { error: updateError } = await client
      .from('profiles')
      .update({ full_name: trimmed })
      .eq('id', session.user.id);
    if (updateError) {
      setError(errorMessage(updateError));
      setBusy(false);
      return;
    }
    // أول تسجيل: بعد الاسم ← إضافة أول عنوان (T12). إن تعذّر الفحص لا نوقف المستخدم.
    const needsAddress = await hasAnyAddress(client).then(
      (has) => !has,
      () => false,
    );
    if (needsAddress) {
      router.replace({ pathname: NEW_ADDRESS, params: { onboarding: '1', redirect } });
    } else {
      router.replace(redirect);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.main}>
          <View style={styles.intro}>
            <AppText accessibilityRole="header" weight="bold" size="display">
              {ar.auth.nameTitle}
            </AppText>
            <AppText muted>{ar.auth.nameHint}</AppText>
          </View>
          <View style={styles.group}>
            <FieldLabel text={ar.auth.name} />
            <TextInput
              testID="name-input"
              accessibilityLabel={ar.auth.name}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              maxLength={NAME_MAX}
              autoFocus
              style={styles.input}
            />
            <AppText size="small" muted>
              {ar.auth.nameLater}
            </AppText>
          </View>
          {error ? <FormMessage text={error} /> : null}
        </View>
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.auth.nameSave}
            onPress={() => void save()}
            disabled={trimmed.length < 2 || !session}
            loading={busy}
            testID="name-submit"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  main: { flex: 1, padding: spacing.screen, paddingTop: 72, gap: 28 },
  intro: { gap: spacing.xs },
  group: { gap: spacing.xs },
  input: {
    height: sizes.primaryButton,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.input,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: fontSizes.title,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  footer: { padding: spacing.lg, paddingBottom: spacing.lg + 8 },
});
