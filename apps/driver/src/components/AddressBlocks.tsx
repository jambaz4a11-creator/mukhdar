// عنوان التسليم بمربعات كبيرة على أخضر (التصميم OrderDetail): البلوك، البناية، الطابق (G للأرضي)، الشقة؛ المفقود يُخفى.
import { StyleSheet, View } from 'react-native';
import { addressBoxes } from '../features/orders/address';
import type { AddressSnapshotView } from '../features/orders/types';
import { ar } from '../i18n/ar';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';

const SOFT_LABEL = '#E2EFE5';

export function AddressBlocks({ snapshot }: { snapshot: AddressSnapshotView | null }) {
  const boxes = addressBoxes(snapshot);
  const note = (snapshot?.note ?? '').trim();
  return (
    <View style={styles.section} testID="address-section">
      <AppText size="small" color={SOFT_LABEL}>
        {ar.orders.addressTitle}
      </AppText>
      <View style={styles.grid}>
        {boxes.map((b) => (
          <View key={b.key} style={styles.box} testID={`address-box-${b.key}`}>
            <AppText size="caption" color={SOFT_LABEL}>
              {b.label}
            </AppText>
            <AppText weight="bold" size="heading" color={colors.surface}>
              {b.value}
            </AppText>
          </View>
        ))}
      </View>
      {note ? (
        <View style={styles.note}>
          <AppText size="caption" color={SOFT_LABEL}>
            {ar.orders.addressNote}
          </AppText>
          <AppText color={colors.surface}>{note}</AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.primary, borderRadius: 20, padding: 18, gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  box: {
    width: '48.5%',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: spacing.md,
    padding: spacing.sm,
  },
  note: { gap: 2 },
});
