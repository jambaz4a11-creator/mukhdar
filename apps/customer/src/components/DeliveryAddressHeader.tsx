// "التوصيل إلى" بأعلى الرئيسية (تصميم Home، مؤجل من T11 إلى T12). الضغط يفتح اختيار العنوان.
// بلا دخول: "اختر عنوان التوصيل" (اختيار العنوان يطلب الدخول). بلا عناوين: إضافة أول عنوان.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatAddressShort } from '@mukhdar/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { addressParts } from '../features/addresses/api';
import { useDeliveryAddress } from '../features/addresses/hooks';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { colors, sizes } from '../theme';
import { AppText } from './AppText';

export function DeliveryAddressHeader() {
  const signedIn = useAuth((s) => s.session !== null);
  const { address, data, isPending, fetchStatus } = useDeliveryAddress();
  const loading = signedIn && isPending && fetchStatus !== 'idle';
  const parts = address ? addressParts(address) : null;
  const noAddresses = signedIn && !loading && (data?.length ?? 0) === 0;

  const text = parts
    ? formatAddressShort(parts)
    : loading
      ? ar.home.loading
      : noAddresses
        ? ar.address.addFirst
        : ar.address.chooseAddress;

  const open = () => {
    if (noAddresses) router.push('/address/new');
    else router.push({ pathname: '/address', params: { select: '1' } });
  };

  return (
    <View style={styles.wrap}>
      <AppText size="caption" muted>
        {ar.address.deliverTo}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${ar.address.deliverTo}: ${text}`}
        onPress={open}
        style={styles.button}
        testID="delivery-address"
      >
        <Ionicons name="location-outline" size={18} color={colors.primary} />
        <AppText weight="semibold" size="small" numberOfLines={1} style={styles.text}>
          {text}
        </AppText>
        <Ionicons name="chevron-down" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, gap: 2 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: sizes.touchTarget,
  },
  text: { flexShrink: 1 },
});
