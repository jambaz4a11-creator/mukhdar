// حسابي (SPEC-driver §2.10، التصميم Account): الاسم والرقم و"سائق"، تغيير الرمز، اتصال/واتساب المحل، الخروج، وحذف
// الحساب (إضافة على التصميم، مطلوب لـ iOS) بتأكيد. الخروج يحذف رمز الإشعارات قبل signOut.
import Ionicons from '@expo/vector-icons/Ionicons';
import { displayPhone, telUrl, whatsappUrl } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { config } from '../../config';
import { deleteDriverAccount } from '../../features/account/account';
import { signOut, useAuth } from '../../features/auth/store';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

function Row({
  title,
  onPress,
  testID,
  last = false,
}: {
  title: string;
  onPress: () => void;
  testID: string;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={[styles.row, !last && styles.rowBorder]}
    >
      <AppText>{title}</AppText>
      <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

export default function AccountScreen() {
  const profile = useAuth((s) => s.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const tel = telUrl(config.shopPhone);
  const whatsapp = whatsappUrl(config.shopWhatsapp);
  const name = profile?.full_name?.trim() ?? '';

  async function signOutPressed() {
    const client = getSupabase();
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    await signOut(client);
    setBusy(false);
  }

  async function deletePressed() {
    const client = getSupabase();
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteDriverAccount(client);
    setConfirmingDelete(false);
    if (!result.ok) setError(result.message);
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.account.title}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <AppText weight="bold" size="heading" color={colors.primary}>
              {name.charAt(0)}
            </AppText>
          </View>
          <View>
            <AppText weight="bold" size="title">
              {name}
            </AppText>
            <AppText size="small" muted style={styles.phone}>
              {displayPhone(profile?.phone)}
            </AppText>
            <AppText size="caption" weight="semibold" color={colors.primary}>
              {ar.account.role}
            </AppText>
          </View>
        </View>

        <View style={styles.group}>
          <Row
            title={ar.account.changePin}
            onPress={() => router.push('/account/change-pin')}
            testID="account-change-pin"
            last={!tel && !whatsapp}
          />
          {tel ? (
            <Row
              title={ar.account.callShop}
              onPress={() => void Linking.openURL(tel)}
              testID="account-call"
              last={!whatsapp}
            />
          ) : null}
          {whatsapp ? (
            <Row
              title={ar.account.whatsappShop}
              onPress={() => void Linking.openURL(whatsapp)}
              testID="account-whatsapp"
              last
            />
          ) : null}
        </View>

        {error ? (
          <View style={styles.error} testID="account-error">
            <AppText size="small" color={colors.danger}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void signOutPressed()}
          disabled={busy}
          style={styles.signOut}
          testID="account-sign-out"
        >
          <AppText weight="bold" color={colors.danger}>
            {ar.common.signOut}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmingDelete(true)}
          disabled={busy}
          style={styles.delete}
          testID="account-delete"
        >
          <AppText size="small" muted>
            {ar.account.deleteAccount}
          </AppText>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={confirmingDelete}
        title={ar.account.deleteTitle}
        body={ar.account.deleteBody}
        confirmLabel={ar.account.deleteConfirm}
        cancelLabel={ar.account.deleteCancel}
        busy={busy}
        danger
        onConfirm={() => void deletePressed()}
        onCancel={() => setConfirmingDelete(false)}
        confirmTestID="delete-confirm"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.screen, paddingTop: 18, paddingBottom: spacing.md },
  content: { padding: spacing.lg, gap: spacing.md },
  profile: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: '#E2EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: { writingDirection: 'ltr' },
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    minHeight: sizes.primaryButton,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  signOut: {
    minHeight: 52,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: '#E3C9C5',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delete: { minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
  error: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.dangerSoft },
});
