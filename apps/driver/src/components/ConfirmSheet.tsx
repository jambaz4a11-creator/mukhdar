// نافذة تأكيد التسليم (التأكيد المزدوج، SPEC-driver §2.8): تعرض المبلغ؛ "نعم" يرسل delivered، "رجوع" يغلق بلا طلب.
import { Modal, StyleSheet, View } from 'react-native';
import { ar } from '../i18n/ar';
import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

interface Props {
  visible: boolean;
  amountText: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({ visible, amountText, busy = false, onConfirm, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="confirm-sheet">
          <AppText weight="bold" size="title">
            {ar.orders.confirmTitle}
          </AppText>
          <AppText testID="confirm-body">{ar.orders.confirmBody(amountText)}</AppText>
          <PrimaryButton
            title={ar.orders.confirmYes}
            onPress={onConfirm}
            loading={busy}
            testID="confirm-yes"
          />
          <SecondaryButton
            title={ar.orders.confirmNo}
            onPress={onCancel}
            disabled={busy}
            testID="confirm-no"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    padding: spacing.screen,
    gap: spacing.md,
  },
});
