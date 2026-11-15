// بدل مؤشر التحميل حين يتوقف الاستعلام لانقطاع الشبكة ولا توجد بيانات محفوظة (مراجعة S4).
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { ar } from '../i18n/ar';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export function OfflineState() {
  return (
    <View style={styles.box} testID="offline-state" accessible>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
      <AppText weight="semibold">{ar.offline.title}</AppText>
      <AppText muted size="small" style={styles.center}>
        {ar.offline.hint}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.screen },
  center: { textAlign: 'center' },
});
