// تأكيد الطلب (T13، SPEC-customer §2.4، تصميم Checkout): عنوان التوصيل (المختار أو الافتراضي، تغيير، إضافة)،
// ملاحظة (300 حرف)، "نقداً عند الاستلام"، الملخص، وزر التأكيد. محمية بالدخول.
// المجموع بالزر تقديري من الكتالوج؛ المجموع الحقيقي يرجع من place_order ويُعرض بشاشة الطلب.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatAddress, formatIQD, formatQuantity } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { FormMessage } from '../components/AuthFields';
import { PrimaryButton } from '../components/PrimaryButton';
import { StoreClosedBanner } from '../components/StoreClosedBanner';
import { SummaryRow } from '../components/SummaryRow';
import { addressNeedsFix, addressParts, type CustomerAddress } from '../features/addresses/api';
import { useDeliveryAddress } from '../features/addresses/hooks';
import { useSelectedAddress } from '../features/addresses/selected';
import { useRequireAuth } from '../features/auth/useRequireAuth';
import { useCartSummary } from '../features/cart/summary';
import { ORDER_NOTE_MAX, usePlaceOrder } from '../features/checkout/usePlaceOrder';
import { ar } from '../i18n/ar';
import { colors, fontSizes, fonts, radius, sizes, spacing } from '../theme';
import { OfflineState } from '../components/OfflineState';
import { isFirstLoad, isOfflineEmpty, useIsOnline } from '../lib/network';

export default function CheckoutScreen() {
  const session = useRequireAuth();
  const { summary } = useCartSummary();
  const addresses = useDeliveryAddress();
  const select = useSelectedAddress((s) => s.select);
  const { submit, sending, failure } = usePlaceOrder();
  const [note, setNote] = useState('');
  // SPEC-customer §1: بدون اتصال زر الطلب معطّل (مراجعة S4)
  const online = useIsOnline();

  if (!session) return null;

  const usable = (addresses.data ?? []).filter((a) => addressParts(a) !== null);
  const address = addresses.address;
  const empty = summary.count === 0;
  const canConfirm =
    !empty &&
    address !== null &&
    summary.storeOpen &&
    !summary.blocked &&
    !summary.belowMin &&
    online &&
    !sending;
  const title = failure?.retryable
    ? ar.checkout.retry
    : ar.checkout.confirm(formatIQD(summary.total));

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.checkout.back}
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/cart'))}
            style={styles.back}
          >
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
          <AppText accessibilityRole="header" weight="bold" size="title">
            {ar.checkout.title}
          </AppText>
        </View>

        <StoreClosedBanner />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.main}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <AppText weight="bold">{ar.checkout.address}</AppText>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/address/new')}
                style={styles.link}
                testID="checkout-new-address"
              >
                <AppText size="small" weight="semibold" color={colors.primary}>
                  {ar.checkout.newAddress}
                </AppText>
              </Pressable>
            </View>
            {isFirstLoad(addresses) ? (
              <ActivityIndicator color={colors.primary} />
            ) : isOfflineEmpty(addresses) ? (
              <OfflineState />
            ) : usable.length === 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/address/new')}
                style={styles.card}
                testID="checkout-no-address"
              >
                <AppText muted>{ar.checkout.noAddress}</AppText>
              </Pressable>
            ) : (
              usable.map((a) => (
                <AddressOption
                  key={a.id}
                  address={a}
                  selected={a.id === address?.id}
                  onPress={() =>
                    // عنوان قديم غير صالح: يُفتح للتصحيح بدل اختياره (2026-11-19)
                    addressNeedsFix(a)
                      ? router.push({ pathname: '/address/[id]', params: { id: a.id } })
                      : select(a.id)
                  }
                />
              ))
            )}
          </View>

          <View style={styles.section}>
            <AppText weight="bold">
              {ar.checkout.note}{' '}
              <AppText size="small" muted>
                {ar.address.optional}
              </AppText>
            </AppText>
            <TextInput
              testID="order-note"
              accessibilityLabel={ar.checkout.note}
              value={note}
              onChangeText={setNote}
              maxLength={ORDER_NOTE_MAX}
              multiline
              numberOfLines={3}
              placeholder={ar.checkout.notePlaceholder}
              placeholderTextColor={colors.textMuted}
              style={styles.note}
            />
            <AppText size="caption" muted style={styles.counter}>
              {`${note.length}/${ORDER_NOTE_MAX}`}
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText weight="bold">{ar.checkout.payment}</AppText>
            <View style={[styles.card, styles.payment]}>
              <View style={styles.cashIcon}>
                <Ionicons name="cash-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <AppText weight="semibold">{ar.checkout.cash}</AppText>
                <AppText size="small" muted>
                  {ar.checkout.cashHint}
                </AppText>
              </View>
            </View>
          </View>

          <View style={[styles.card, styles.summary]} accessibilityLabel={ar.checkout.summaryA11y}>
            {summary.lines.map((l) =>
              l.product ? (
                <SummaryRow
                  key={l.id}
                  label={`${l.product.name} · ${formatQuantity(l.qty, l.product.unit)}`}
                  value={formatIQD(l.lineTotal)}
                />
              ) : null,
            )}
            <View style={styles.divider} />
            <SummaryRow
              label={ar.cart.deliveryFee}
              value={summary.deliveryFee === null ? '…' : formatIQD(summary.deliveryFee)}
            />
            <SummaryRow
              label={ar.cart.total}
              value={formatIQD(summary.total)}
              strong
              testID="checkout-total"
            />
            <AppText size="caption" muted>
              {ar.cart.finalNote}
            </AppText>
          </View>

          {empty ? <FormMessage text={ar.checkout.emptyCart} /> : null}
          {failure ? <FormMessage text={failure.message} /> : null}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            title={title}
            onPress={() => {
              if (address) void submit({ addressId: address.id, note });
            }}
            disabled={!canConfirm}
            loading={sending}
            testID="checkout-confirm"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AddressOption({
  address,
  selected,
  onPress,
}: {
  address: CustomerAddress;
  selected: boolean;
  onPress: () => void;
}) {
  const parts = addressParts(address);
  if (!parts) return null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={formatAddress(parts)}
      onPress={onPress}
      style={[styles.card, styles.option, selected && styles.optionSelected]}
      testID={`checkout-address-${address.id}`}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={colors.primary}
      />
      <View style={styles.flex}>
        {address.label ? <AppText weight="semibold">{address.label}</AppText> : null}
        <AppText size="small">{formatAddress(parts)}</AppText>
        {addressNeedsFix(address) ? (
          <AppText size="caption" color={colors.warningText} testID={`checkout-fix-${address.id}`}>
            {ar.address.needsFix}
          </AppText>
        ) : null}
        {address.note ? (
          <AppText size="caption" muted>
            {address.note}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, gap: 18 },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { minHeight: sizes.touchTarget, justifyContent: 'center' },
  card: {
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  option: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  optionSelected: { borderWidth: 2, borderColor: colors.primary },
  note: {
    minHeight: 88,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.text,
    textAlign: 'right',
    textAlignVertical: 'top',
    writingDirection: 'rtl',
  },
  counter: { alignSelf: 'flex-end' },
  payment: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cashIcon: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.control,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { gap: spacing.sm, padding: spacing.lg },
  divider: { height: 1, backgroundColor: colors.border },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.screen,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
