// السلة (T13، SPEC-customer §2.3، تصميم Cart): البنود بعداد (وحدة بيع بكل ضغطة، formatQuantity)، حذف،
// الملخص (المجموع الفرعي، أجرة التوصيل والكلي من app_settings)، تحذير الحد الأدنى، وتعليم ما صار غير متوفر
// بعد تحديث الكتالوج عند فتح السلة. التصفح والسلة بدون دخول؛ التأكيد يطلب الدخول.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIQD } from '@mukhdar/shared';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ProductImage } from '../../components/ProductImage';
import { QuantityStepper } from '../../components/QuantityStepper';
import { StoreClosedBanner } from '../../components/StoreClosedBanner';
import { SummaryRow } from '../../components/SummaryRow';
import { MAX_QTY, useCart } from '../../features/cart/store';
import { type CartLineView, type CartSummary, useCartSummary } from '../../features/cart/summary';
import { ar } from '../../i18n/ar';
import { colors, radius, sizes, spacing } from '../../theme';
import { useRefetchOnFocus } from '../../lib/useRefetchOnFocus';

export default function CartScreen() {
  const { summary, products } = useCartSummary();
  // التبويب يبقى مركّباً: أحدث أسعار وتوفر عند كل رجوع للسلة (مراجعة S3)
  useRefetchOnFocus(products.refetch, summary.count > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="heading">
          {ar.cart.title}
        </AppText>
        {summary.count > 0 ? (
          <AppText size="small" muted testID="cart-count">
            {ar.cart.count(summary.count)}
          </AppText>
        ) : null}
      </View>

      {summary.count === 0 ? (
        <EmptyCart />
      ) : (
        <>
          <StoreClosedBanner />
          <FlatList
            style={styles.flex}
            data={summary.lines}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <CartLine line={item} />}
            ListFooterComponent={<Summary summary={summary} />}
          />
          <View style={styles.footer}>
            <PrimaryButton
              title={ar.cart.continue}
              onPress={() => router.push('/checkout')}
              disabled={summary.blocked || summary.belowMin}
              testID="cart-continue"
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function EmptyCart() {
  return (
    <View style={styles.empty} testID="cart-empty">
      <Ionicons name="cart-outline" size={48} color={colors.textMuted} />
      <AppText weight="semibold" size="title">
        {ar.cart.empty}
      </AppText>
      <AppText muted>{ar.cart.emptyHint}</AppText>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/')}
        style={styles.browse}
      >
        <AppText weight="semibold" color={colors.primary}>
          {ar.cart.browse}
        </AppText>
      </Pressable>
    </View>
  );
}

function CartLine({ line }: { line: CartLineView }) {
  const increment = useCart((s) => s.increment);
  const decrement = useCart((s) => s.decrement);
  const remove = useCart((s) => s.remove);
  const name = line.product?.name ?? ar.cart.unknownProduct;

  if (line.status === 'unavailable') {
    return (
      <View
        style={[styles.card, styles.cardDanger]}
        accessibilityRole="alert"
        testID={`cart-line-${line.id}`}
      >
        <ProductImage name={name} imagePath={null} style={styles.image} letterSize={24} dimmed />
        <View style={styles.info}>
          <AppText weight="semibold">{name}</AppText>
          <AppText size="small" color={colors.danger}>
            {ar.cart.unavailable}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ar.cart.removeA11y(name)}
          onPress={() => remove(line.id)}
          style={styles.removeIcon}
        >
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
        </Pressable>
      </View>
    );
  }

  const unit = line.product?.unit ?? '';
  return (
    <View
      style={[styles.card, line.status === 'insufficient' && styles.cardWarn]}
      testID={`cart-line-${line.id}`}
    >
      <ProductImage
        name={name}
        imagePath={line.product?.image_path ?? null}
        style={styles.image}
        letterSize={24}
      />
      <View style={styles.info}>
        <AppText weight="semibold" numberOfLines={1}>
          {name}
        </AppText>
        {line.product ? (
          <AppText size="caption" muted>
            {`${formatIQD(line.product.price_iqd)} ${ar.catalog.perUnit(unit)}`}
          </AppText>
        ) : null}
        {line.product ? <AppText weight="bold">{formatIQD(line.lineTotal)}</AppText> : null}
        {line.status === 'insufficient' ? (
          <AppText size="caption" color={colors.danger}>
            {ar.cart.insufficient}
          </AppText>
        ) : null}
      </View>
      <View style={styles.controls}>
        <QuantityStepper
          qty={line.qty}
          unit={unit}
          onIncrement={() => increment(line.id)}
          onDecrement={() => decrement(line.id)}
          canIncrement={line.qty < MAX_QTY}
          canDecrement={line.qty > 1}
          style={styles.stepper}
          testID={`cart-stepper-${line.id}`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ar.cart.removeA11y(name)}
          onPress={() => remove(line.id)}
          style={styles.remove}
          testID={`cart-remove-${line.id}`}
        >
          <Ionicons name="trash-outline" size={14} color={colors.danger} />
          <AppText size="caption" color={colors.danger}>
            {ar.cart.remove}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

function Summary({ summary }: { summary: CartSummary }) {
  return (
    <View style={styles.footerContent}>
      {summary.belowMin ? (
        <View style={styles.warning} accessibilityRole="alert" testID="min-order-warning">
          <AppText size="small" color={colors.warningText}>
            {ar.cart.belowMin(
              formatIQD(summary.minOrder),
              formatIQD(summary.minOrder - summary.subtotal),
            )}
          </AppText>
        </View>
      ) : null}
      {summary.blocked ? (
        <AppText size="small" color={colors.danger} testID="cart-blocked">
          {ar.cart.blockedHint}
        </AppText>
      ) : null}
      <View style={styles.summary} accessibilityLabel={ar.cart.summaryA11y}>
        <SummaryRow
          label={ar.cart.subtotal}
          value={formatIQD(summary.subtotal)}
          testID="cart-subtotal"
        />
        <SummaryRow
          label={ar.cart.deliveryFee}
          value={summary.deliveryFee === null ? '…' : formatIQD(summary.deliveryFee)}
          testID="cart-delivery-fee"
        />
        <View style={styles.divider} />
        <SummaryRow
          label={ar.cart.total}
          value={formatIQD(summary.total)}
          strong
          testID="cart-total"
        />
        <AppText size="caption" muted>
          {ar.cart.finalNote}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.screen,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
  cardWarn: { borderColor: colors.danger },
  image: { width: 64, height: 64, borderRadius: radius.control },
  info: { flex: 1, minWidth: 0, gap: 4 },
  controls: { alignItems: 'center', gap: 2 },
  stepper: { minWidth: 140 },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.xs,
  },
  removeIcon: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerContent: { gap: spacing.sm, marginTop: 4 },
  warning: { borderRadius: radius.card, padding: spacing.md, backgroundColor: colors.warningSoft },
  summary: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  divider: { height: 1, backgroundColor: colors.border },
  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.screen,
  },
  browse: { minHeight: sizes.touchTarget, justifyContent: 'center', marginTop: spacing.xs },
});
