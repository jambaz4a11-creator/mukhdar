// تفاصيل المنتج (T11، تصميم Product): صورة كبيرة، الاسم والقسم، السعر لكل وحدة بيع، الوصف،
// عداد الكمية (كل ضغطة = وحدة بيع) وزر "أضف للسلة" مع المجموع التقريبي.
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorMessage, formatIQD } from '@mukhdar/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { ProductImage } from '../../components/ProductImage';
import { QuantityStepper } from '../../components/QuantityStepper';
import type { Product } from '../../features/catalog/api';
import { useCategories, useProduct } from '../../features/catalog/hooks';
import { MAX_QTY, useCart, useCartQty } from '../../features/cart/store';
import { ar } from '../../i18n/ar';
import { colors, radius, sizes, spacing } from '../../theme';

const IMAGE_HEIGHT = 340;

export default function ProductScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const product = useProduct(id);

  if (product.data) return <ProductDetails product={product.data} />;

  return (
    <SafeAreaView style={styles.safe}>
      <BackButton floating={false} />
      <View style={styles.state}>
        {product.isPending && product.fetchStatus !== 'idle' ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={ar.home.loading} />
        ) : product.isError ? (
          <>
            <AppText color={colors.danger} style={styles.center}>
              {errorMessage(product.error)}
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => void product.refetch()}
              style={styles.retry}
            >
              <AppText weight="semibold" color={colors.primary}>
                {ar.home.retry}
              </AppText>
            </Pressable>
          </>
        ) : (
          <AppText weight="semibold" style={styles.center}>
            {ar.product.notFound}
          </AppText>
        )}
      </View>
    </SafeAreaView>
  );
}

function ProductDetails({ product }: { product: Product }) {
  const insets = useSafeAreaInsets();
  const categories = useCategories();
  const cartQty = useCartQty(product.id);
  const setQty = useCart((s) => s.setQty);
  // الكمية المختارة تبدأ من كمية السلة (أو وحدة واحدة) وتُحفظ بالسلة عند الضغط على الزر
  const [qty, setLocalQty] = useState(cartQty > 0 ? cartQty : 1);
  const available = product.in_stock;
  const categoryName = categories.data?.find((c) => c.id === product.category_id)?.name;

  const confirm = () => {
    setQty(product.id, qty);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View>
          <ProductImage
            name={product.name}
            imagePath={product.image_path}
            letterSize={96}
            dimmed={!available}
            accessibilityLabel={ar.product.imageA11y(product.name)}
            style={[styles.image, { height: IMAGE_HEIGHT + insets.top }]}
          />
          <View style={[styles.backWrap, { top: insets.top + spacing.lg }]}>
            <BackButton floating />
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={styles.titleText}>
              <AppText weight="bold" size="heading" accessibilityRole="header">
                {product.name}
              </AppText>
              <AppText muted size="small">
                {[categoryName, ar.catalog.pricePerUnit(product.unit)].filter(Boolean).join(' · ')}
              </AppText>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: available ? colors.primarySoft : colors.divider },
              ]}
            >
              <AppText
                size="small"
                weight="semibold"
                color={available ? colors.primary : colors.textMuted}
              >
                {available ? ar.catalog.inStock : ar.catalog.outOfStockLong}
              </AppText>
            </View>
          </View>

          <AppText style={styles.priceLine}>
            <AppText weight="bold" size="display">
              {formatIQD(product.price_iqd)}
            </AppText>
            <AppText weight="medium" muted>
              {` ${ar.catalog.perUnit(product.unit)}`}
            </AppText>
          </AppText>

          {product.description ? (
            <AppText style={styles.description} color={colors.textMuted}>
              {product.description}
            </AppText>
          ) : null}

          {available && (
            <View style={styles.qtyBlock}>
              <AppText weight="semibold" size="small">
                {ar.product.quantity}
              </AppText>
              <View style={styles.qtyRow}>
                <QuantityStepper
                  testID="product-stepper"
                  variant="large"
                  qty={qty}
                  unit={product.unit}
                  canIncrement={qty < MAX_QTY}
                  canDecrement={qty > 1}
                  onIncrement={() => setLocalQty((n) => Math.min(MAX_QTY, n + 1))}
                  onDecrement={() => setLocalQty((n) => Math.max(1, n - 1))}
                />
                <AppText muted size="small" style={styles.flex}>
                  {ar.product.stepHint(product.unit)}
                </AppText>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Pressable
          testID="product-add"
          accessibilityRole="button"
          accessibilityState={{ disabled: !available }}
          disabled={!available}
          onPress={confirm}
          style={({ pressed }) => [
            styles.cta,
            !available && styles.ctaDisabled,
            pressed && styles.ctaPressed,
          ]}
        >
          <AppText weight="semibold" color={available ? colors.surface : colors.textMuted}>
            {!available
              ? ar.catalog.outOfStockLong
              : cartQty > 0
                ? ar.product.updateCart
                : ar.product.addToCart}
          </AppText>
          {available && (
            <AppText weight="bold" color={colors.surface}>
              {formatIQD(product.price_iqd * qty)}
            </AppText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function BackButton({ floating }: { floating: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ar.product.back}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={[styles.back, !floating && styles.backInline]}
    >
      {/* بالـ RTL الرجوع يشير لليمين */}
      <Ionicons name="chevron-forward" size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  image: { borderRadius: 0 },
  backWrap: { position: 'absolute', start: spacing.lg },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backInline: { margin: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  body: {
    marginTop: -24,
    backgroundColor: colors.background,
    borderTopStartRadius: 24,
    borderTopEndRadius: 24,
    paddingHorizontal: spacing.screen,
    paddingTop: 24,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titleText: { flex: 1, gap: 4 },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  priceLine: { lineHeight: 44 },
  description: { lineHeight: 28 },
  qtyBlock: { gap: spacing.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cta: {
    height: sizes.primaryButton,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaDisabled: { backgroundColor: colors.divider, justifyContent: 'center' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: 24 },
  center: { textAlign: 'center' },
  retry: { minHeight: sizes.touchTarget, justifyContent: 'center' },
});
