// تعديل عنوان (T12): من "عناويني".
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AddressForm } from '../../components/AddressForm';
import { useMyAddresses } from '../../features/addresses/hooks';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';
import { colors, spacing } from '../../theme';

export default function EditAddressScreen() {
  const session = useRequireAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const addresses = useMyAddresses();
  const address = addresses.data?.find((a) => a.id === id);

  if (!session) return null;
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/address'));

  if (!address) {
    return (
      <View style={styles.center}>
        {addresses.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <AppText muted>{ar.address.unavailable}</AppText>
        )}
      </View>
    );
  }
  return <AddressForm initial={address} isFirst={false} onBack={leave} onSaved={leave} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.screen,
    backgroundColor: colors.background,
  },
});
