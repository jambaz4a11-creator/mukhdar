// "اتصل بالمحل" و"واتساب المحل" (SPEC-driver §2.2: واتساب بجانب الاتصال لأنه مسار إعادة الضبط المعتمد، ADR 0001).
// زر بلا رقم مضبوط يختفي؛ بلا الاثنين لا يُعرض شيء.
import { forgotPinWhatsappUrl, telUrl } from '@mukhdar/shared';
import { Linking, StyleSheet, View } from 'react-native';
import { config } from '../config';
import { ar } from '../i18n/ar';
import { spacing } from '../theme';
import { SecondaryButton } from './SecondaryButton';

export function ShopContact({ phoneInput = '' }: { phoneInput?: string }) {
  const tel = telUrl(config.shopPhone);
  const whatsapp = forgotPinWhatsappUrl(config.shopWhatsapp, phoneInput);
  if (!tel && !whatsapp) return null;
  return (
    <View style={styles.row}>
      {tel ? (
        <SecondaryButton
          title={ar.login.callShop}
          icon="call-outline"
          onPress={() => void Linking.openURL(tel)}
          testID="forgot-call"
        />
      ) : null}
      {whatsapp ? (
        <SecondaryButton
          title={ar.login.whatsappShop}
          icon="logo-whatsapp"
          onPress={() => void Linking.openURL(whatsapp)}
          testID="forgot-whatsapp"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.sm } });
