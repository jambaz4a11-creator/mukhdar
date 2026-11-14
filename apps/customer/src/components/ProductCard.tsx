// بطاقة منتج بشبكة الرئيسية (عمودان). ارتفاع ثابت حتى تعمل getItemLayout (تمرير سلس لـ 60+ منتجاً).
// زر "أضف" يتحول لعداد عند وجود المنتج بالسلة؛ غير المتوفر باهت وبلا زر إضافة.
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

export const CARD_HEIGHT = 246;
const IMAGE_HEIGHT = 104;

interface Props {
  product: Product;
  onOpen: (product: Product) => void;
}

export const ProductCard = memo(function ProductCard({ product, onOpen }: Props) {
  const qty = useCartQty(product.id);
  const increment = useCart((s) => s.increment);
  const decrement = useCart((s) => s.decrement);
  const available = product.in_stock;

  return (
    <View style={styles.card} testID={`product-card-${product.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}، ${formatIQD(product.price_iqd)} ${ar.catalog.perUnit(product.unit)}${available ? '' : `، ${ar.catalog.outOfStock}`}`}
        onPress={() => onOpen(product)}
        style={styles.info}
      >
        <View>
          <ProductImage
            name={product.name}
            imagePath={product.image_path}
            dimmed={!available}
            style={styles.image}
          />
          {!available && (
            <View style={styles.soldOutTag}>
              <AppText size="caption" weight="semibold" muted>
                {ar.catalog.outOfStockLong}
              </AppText>
            </View>
          )}
        </View>
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
      </Pressable>

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
  );
});

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  info: { flex: 1, gap: 6 },
  image: { height: IMAGE_HEIGHT },
  soldOutTag: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
  },
  name: { lineHeight: 24 },
  price: { lineHeight: 22 },
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
