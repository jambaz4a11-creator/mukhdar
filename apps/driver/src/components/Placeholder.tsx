// تبويب لم يُبنَ بعد (T30): العنوان وسطر "تنبني بالمرحلة الجاية".
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ar } from '../i18n/ar';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

export function Placeholder({ title, testID }: { title: string; testID: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center} testID={testID}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {title}
        </AppText>
        <AppText muted>{ar.tabs.soon}</AppText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
