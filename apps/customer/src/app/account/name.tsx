// تعديل الاسم من حسابي (T15): profiles.full_name (2..80 حرفاً بعد تنظيف المسافات). محمية بالدخول.
import { errorMessage } from '@mukhdar/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '../../components/BackHeader';
import { FieldLabel, FormMessage } from '../../components/AuthFields';
import { PrimaryButton } from '../../components/PrimaryButton';
import {
  cleanName,
  NAME_MAX,
  NAME_MIN,
  profileKeys,
  updateFullName,
} from '../../features/account/api';
import { useFullName } from '../../features/account/hooks';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../../theme';

export default function EditNameScreen() {
  const session = useRequireAuth();
  const queryClient = useQueryClient();
  const current = useFullName();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // يملأ الحقل بالاسم الحالي عند وصوله (ما لم يبدأ المستخدم بالكتابة)
  useEffect(() => {
    if (!touched && current.data) setName(current.data);
  }, [current.data, touched]);

  if (!session) return null;
  const cleaned = cleanName(name);
  const valid = cleaned.length >= NAME_MIN && cleaned !== (current.data ?? '');

  async function save() {
    const client = getSupabase();
    if (!client || !session || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateFullName(client, session.user.id, cleaned);
      queryClient.setQueryData(profileKeys.me(session.user.id), cleaned);
      if (router.canGoBack()) router.back();
      else router.replace('/account');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <BackHeader title={ar.account.nameTitle} backLabel={ar.account.back} fallback="/account" />
        <View style={styles.main}>
          <FieldLabel text={ar.auth.name} />
          <TextInput
            testID="name-input"
            accessibilityLabel={ar.auth.name}
            value={name}
            onChangeText={(v) => {
              setTouched(true);
              setName(v);
            }}
            autoComplete="name"
            textContentType="name"
            maxLength={NAME_MAX}
            autoFocus
            style={styles.input}
          />
          {error ? <FormMessage text={error} /> : null}
        </View>
        <View style={styles.footer}>
          <PrimaryButton
            title={ar.account.nameSave}
            onPress={() => void save()}
            disabled={!valid}
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
  main: { flex: 1, paddingHorizontal: spacing.screen, gap: spacing.xs },
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
