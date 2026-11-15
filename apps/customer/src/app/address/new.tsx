// إضافة عنوان (T12). بعد شاشة الاسم أول مرة: onboarding=1 ("الخطوة 2 من 2" وزر "لاحقاً") ثم redirect.
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AddressForm } from '../../components/AddressForm';
import { useMyAddresses } from '../../features/addresses/hooks';
import { safeRedirect } from '../../features/auth/redirect';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { colors } from '../../theme';

type Params = { redirect?: string; onboarding?: string };

export default function NewAddressScreen() {
  const session = useRequireAuth();
  const params = useLocalSearchParams<Params>();
  const onboarding = params.onboarding === '1';
  const redirect = params.redirect === undefined ? null : safeRedirect(params.redirect);
  const addresses = useMyAddresses();

  if (!session) return null;
  // نعرف هل هو أول عنوان (يصير افتراضياً) قبل رسم النموذج
  if (addresses.isPending && addresses.fetchStatus !== 'idle') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const leave = () => {
    if (onboarding || redirect !== null) router.replace(redirect ?? '/');
    else if (router.canGoBack()) router.back();
    else router.replace('/address');
  };

  return (
    <AddressForm
      isFirst={(addresses.data?.length ?? 0) === 0 && !addresses.isError}
      onboarding={onboarding}
      onBack={leave}
      onSaved={leave}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
