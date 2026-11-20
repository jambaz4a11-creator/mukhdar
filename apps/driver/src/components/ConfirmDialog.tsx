// نافذة تأكيد عامة (حذف الحساب). `ConfirmSheet` الخاصة بالتسليم تبقى لنصها وأرقامها.
import { Modal, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { AppText } from './AppText';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmTestID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
  confirmTestID,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="confirm-dialog">
          <AppText weight="bold" size="title" color={danger ? colors.danger : undefined}>
            {title}
          </AppText>
          <AppText>{body}</AppText>
          <PrimaryButton
            title={confirmLabel}
            onPress={onConfirm}
            loading={busy}
            testID={confirmTestID}
          />
          <SecondaryButton title={cancelLabel} onPress={onCancel} disabled={busy} />
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
