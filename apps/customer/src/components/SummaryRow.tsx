// سطر بملخص السلة/الطلب: العنوان يميناً والمبلغ يساراً (RTL).
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';

export function SummaryRow({
  label,
  value,
  strong = false,
  testID,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <AppText
        muted={!strong}
        weight={strong ? 'bold' : 'regular'}
        size={strong ? 'title' : 'body'}
        style={styles.label}
      >
        {label}
      </AppText>
      <AppText
        weight={strong ? 'bold' : 'semibold'}
        size={strong ? 'title' : 'body'}
        testID={testID}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: { flexShrink: 1 },
});
