// بطاقة منتج بشبكة الرئيسية (عمودان؛ نفس الشبكة للأقسام ونتائج البحث). تصميم 2026-11-18: الصورة المربعة أكبر عنصر
// بعرض البطاقة كاملاً (contain على خلفية بيضاء، بديل محايد بلا صورة)، ثم الاسم والسعر، وزر الإضافة بالأسفل.
// ارتفاع البطاقة يُحسب من عرضها (cardHeight) حتى تعمل getItemLayout (تمرير سلس لـ 60+ منتجاً).
// زر "أضف" يتحول لعداد (نص كيلو بكل ضغطة) عند وجود المنتج بالسلة؛ غير المتوفر باهت وبلا زر إضافة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIQD } from '@mukhdar/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type Product } from '../features/catalog/api';
import { MAX_QTY, useCart, useCartQty } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { ProductImage } from './ProductImage';
import { QuantityStepper } from './QuantityStepper';

const NAME_LINE = 24;
const PRICE_LINE = 22;
const INFO_PAD = spacing.xs;
/** كل ما تحت الصورة: حشوة + الاسم + السعر + فراغ + الزر + حشوة. */
export const CARD_INFO_HEIGHT =
  INFO_PAD + NAME_LINE + 2 + PRICE_LINE + spacing.xs + sizes.touchTarget + spacing.sm;
/** عرض افتراضي (الاختبارات)؛ الشبكة تمرر العرض الحقيقي. */
const DEFAULT_WIDTH = 160;

/** ارتفاع البطاقة بعرض معيّن: صورة مربعة بعرض البطاقة (داخل حد 1px) + الجزء السفلي الثابت. */
export function cardHeight(width: number): number {
  return Math.round(width) + CARD_INFO_HEIGHT;
}

interface Props {
  product: Product;
  onOpen: (product: Product) => void;
  /** عرض البطاقة بالشبكة (يحدد مقاس الصورة المربعة والارتفاع). */
  width?: number;
}

export const ProductCard = memo(function ProductCard({
  product,
  onOpen,
  width = DEFAULT_WIDTH,
}: Props) {
  const qty = useCartQty(product.id);
  const increment = useCart((s) => s.increment);
  const decrement = useCart((s) => s.decrement);
  const available = product.in_stock;
  const imageSize = Math.round(width) - 2; // داخل حد البطاقة

  return (
    <View
      style={[styles.card, { width, height: cardHeight(width) }]}
      testID={`product-card-${product.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}، ${formatIQD(product.price_iqd)} ${ar.catalog.perUnit(product.unit)}${available ? '' : `، ${ar.catalog.outOfStock}`}`}
        onPress={() => onOpen(product)}
        style={styles.flex}
      >
        <View>
          <ProductImage
            name={product.name}
            imagePath={product.image_path}
            dimmed={!available}
            fit="contain"
            letterSize={Math.max(28, Math.round(imageSize / 4))}
            style={[styles.image, { width: imageSize, height: imageSize }]}
            testID={`product-image-${product.id}`}
          />
          {!available && (
            <View style={styles.soldOutTag}>
              <AppText size="caption" weight="semibold" muted>
                {ar.catalog.outOfStockLong}
              </AppText>
            </View>
          )}
        </View>
        <View style={styles.text}>
          <AppText weight="semibold" numberOfLines={1} style={styles.name}>
            {product.name}
          </AppText>
          <AppText numberOfLines={1} style={styles.price}>
            <AppText weight="bold" size="small" color={available ? colors.text : colors.textMuted}>
              {formatIQD(product.price_iqd)}
            </AppText>
            <AppText size="caption" muted>
              {` ${ar.catalog.perUnit(product.unit)}`}
            </AppText>
          </AppText>
        </View>
      </Pressable>

      <View style={styles.bottom}>
        {!available ? (
          <View style={[styles.action, styles.soldOut]}>
            <AppText size="small" weight="medium" muted>
              {ar.catalog.outOfStock}
            </AppText>
          </View>
        ) : qty > 0 ? (
          <QuantityStepper
            testID={`stepper-${product.id}`}
            qty={qty}
            unit={product.unit}
            canIncrement={qty < MAX_QTY}
            onIncrement={() => increment(product.id)}
            onDecrement={() => decrement(product.id)}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ar.catalog.addA11y(product.name)}
            onPress={() => increment(product.id)}
            style={({ pressed }) => [styles.action, styles.add, pressed && styles.addPressed]}
          >
            <Ionicons name="add" size={18} color={colors.surface} />
            <AppText weight="semibold" size="small" color={colors.surface}>
              {ar.catalog.add}
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  // الصورة حتى حواف البطاقة (الزوايا العليا من البطاقة)، وخط فاصل خفيف تحتها
  image: {
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  soldOutTag: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
  },
  text: { paddingHorizontal: spacing.sm, paddingTop: INFO_PAD, gap: 2 },
  name: { lineHeight: NAME_LINE },
  price: { lineHeight: PRICE_LINE },
  bottom: { paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  action: {
    height: sizes.touchTarget,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  add: { backgroundColor: colors.primary },
  addPressed: { backgroundColor: colors.primaryPressed },
  soldOut: { backgroundColor: colors.divider },
});
