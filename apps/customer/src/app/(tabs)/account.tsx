// حسابي (T15، SPEC-customer §2.9، تصميم Account): الاسم والهاتف وتعديل الاسم، عناويني (T12)، طلباتي، تواصل
// معنا (واتساب/اتصال، مخفية حتى تُضبط)، تغيير رمز الدخول، الخصوصية والشروط (روابط https من البيئة، مخفية حتى
// تُضبط)، تسجيل الخروج، وحذف الحساب (Apple): الزر بهذه الشاشة مباشرة ← تأكيدان ← delete-account.
// تسجيل الخروج يحذف رمز إشعارات الجهاز (T14) ثم يمسح الجلسة، والسلة تبقى. الحذف يفرّغ كل البيانات المحلية.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { FormMessage } from '../../components/AuthFields';
import { config } from '../../config';
import { deleteAccount, httpsUrl, telUrl, whatsappUrl } from '../../features/account/api';
import { useFullName } from '../../features/account/hooks';
import { useMyAddresses } from '../../features/addresses/hooks';
import { displayPhone } from '../../features/auth/api';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { unregisterPushToken } from '../../features/notifications/push';
import { ar } from '../../i18n/ar';
import { captureError, isSentryEnabled } from '../../lib/sentry';
import { getSupabase } from '../../lib/supabase';
import { colors, radius, sizes, spacing } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Row {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  trailing?: string;
  /** يفتح خارج التطبيق (واتساب، اتصال، صفحة ويب) */
  external?: boolean;
}

async function openLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch (e) {
    captureError(e);
    Alert.alert(ar.account.linkFailed);
  }
}

export default function AccountScreen() {
  const session = useRequireAuth();
  const queryClient = useQueryClient();
  const addresses = useMyAddresses();
  const fullName = useFullName();
  const [sent, setSent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (!session) return null;

  const name = fullName.data ?? null;
  const phone = displayPhone(session.user.phone);
  const wa = whatsappUrl(config.shopWhatsapp);
  const tel = telUrl(config.shopPhone);
  const privacy = httpsUrl(config.privacyUrl);
  const terms = httpsUrl(config.termsUrl);

  async function signOut() {
    const client = getSupabase();
    try {
      // رمز الإشعارات أولاً (يحتاج الجلسة، RLS)، ثم إنهاء الجلسة
      if (client) await unregisterPushToken(client);
      await client?.auth.signOut();
    } catch (e) {
      captureError(e);
    }
    router.replace('/');
  }

  async function doDelete() {
    const client = getSupabase();
    if (!client) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteAccount(client, queryClient);
    if (result.ok) {
      router.replace('/');
      Alert.alert(ar.account.deleted);
      return;
    }
    setDeleteError(result.message);
    setDeleting(false);
  }

  function confirmDelete() {
    Alert.alert(ar.account.deleteTitle, ar.account.deleteBody, [
      { text: ar.account.deleteCancel, style: 'cancel' },
      {
        text: ar.account.deleteContinue,
        style: 'destructive',
        onPress: () =>
          Alert.alert(ar.account.deleteFinalTitle, ar.account.deleteFinalBody, [
            { text: ar.account.deleteCancel, style: 'cancel' },
            {
              text: ar.account.deleteFinalConfirm,
              style: 'destructive',
              onPress: () => void doDelete(),
            },
          ]),
      },
    ]);
  }

  const rows: Row[] = [
    {
      key: 'addresses',
      icon: 'location-outline',
      label: ar.address.listTitle,
      onPress: () => router.push('/address'),
      trailing: addresses.data ? String(addresses.data.length) : undefined,
    },
    {
      key: 'orders',
      icon: 'receipt-outline',
      label: ar.account.orders,
      onPress: () => router.navigate('/orders'),
    },
    ...(wa
      ? [
          {
            key: 'whatsapp',
            icon: 'chatbubble-outline' as const,
            label: ar.account.whatsapp,
            onPress: () => void openLink(wa),
            external: true,
          },
        ]
      : []),
    ...(tel
      ? [
          {
            key: 'call',
            icon: 'call-outline' as const,
            label: ar.account.call,
            onPress: () => void openLink(tel),
            external: true,
          },
        ]
      : []),
    {
      key: 'pin',
      icon: 'key-outline',
      label: ar.account.changePin,
      onPress: () => router.push('/account/pin'),
    },
    ...(privacy
      ? [
          {
            key: 'privacy',
            icon: 'document-outline' as const,
            label: ar.account.privacy,
            onPress: () => void openLink(privacy),
            external: true,
          },
        ]
      : []),
    ...(terms
      ? [
          {
            key: 'terms',
            icon: 'document-text-outline' as const,
            label: ar.account.terms,
            onPress: () => void openLink(terms),
            external: true,
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.account.title}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.main}>
        <View style={[styles.card, styles.profile]}>
          <View style={styles.avatar}>
            <AppText weight="bold" size="heading" color={colors.primary}>
              {name ? name.charAt(0) : '؟'}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText weight="bold" size="title" testID="account-name">
              {name ?? ar.account.noName}
            </AppText>
            <AppText muted style={styles.phone} testID="account-phone">
              {phone}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.account.editName}
            onPress={() => router.push('/account/name')}
            style={styles.iconButton}
            testID="edit-name"
          >
            <Ionicons name="pencil-outline" size={18} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.card} accessibilityLabel={ar.account.settingsA11y}>
          {rows.map((row, i) => (
            <Pressable
              key={row.key}
              accessibilityRole={row.external ? 'link' : 'button'}
              onPress={row.onPress}
              style={[styles.row, i < rows.length - 1 && styles.rowDivider]}
              testID={row.key === 'addresses' ? 'my-addresses' : `account-${row.key}`}
            >
              <Ionicons name={row.icon} size={20} color={colors.primary} />
              <AppText style={styles.flex}>{row.label}</AppText>
              {row.trailing ? (
                <AppText size="small" muted>
                  {row.trailing}
                </AppText>
              ) : null}
              <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={[styles.row, styles.rowDivider]}
            testID="sign-out"
          >
            <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
            <AppText>{ar.auth.signOut}</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: deleting, busy: deleting }}
            disabled={deleting}
            onPress={confirmDelete}
            style={styles.row}
            testID="delete-account"
          >
            {deleting ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            )}
            <AppText color={colors.danger}>
              {deleting ? ar.account.deleting : ar.account.deleteAccount}
            </AppText>
          </Pressable>
        </View>
        {deleteError ? <FormMessage text={deleteError} /> : null}
        <AppText size="caption" muted style={styles.center}>
          {ar.account.deleteNote}
        </AppText>

        {/* اختبار T09 اليدوي: خطأ متعمد يصل لـ Sentry. يظهر فقط بالتطوير ومع DSN مضبوط. */}
        {__DEV__ && isSentryEnabled() ? (
          <Pressable
            accessibilityRole="button"
            style={styles.devButton}
            onPress={() => {
              captureError(new Error('Sentry test error (T09, manual)'));
              setSent(true);
            }}
          >
            <AppText weight="medium" color={colors.danger}>
              {sent ? ar.dev.sentrySent : ar.dev.sentryTest}
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.screen,
    paddingBottom: spacing.md,
  },
  main: { paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, gap: spacing.lg },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // الرقم يُقرأ من اليسار لليمين
  phone: { writingDirection: 'ltr', textAlign: 'right' },
  iconButton: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  center: { textAlign: 'center' },
  devButton: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.dangerSoft,
  },
});
