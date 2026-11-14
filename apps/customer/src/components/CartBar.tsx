// شريط السلة العائم (يظهر عند وجود بنود): عدد المنتجات والمجموع التقريبي من أسعار الكتالوج المخزنة.
// المجموع النهائي يُحسب داخل place_order (T13).
import { formatIQD } from '@mukhdar/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';
import { cachedProductMap } from '../features/catalog/cache';
import { useCart } from '../features/cart/store';
import { ar } from '../i18n/ar';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export const CART_BAR_SPACE = sizes.primaryButton + spacing.sm * 2;

export function CartBar({ onPress }: { onPress: () => void }) {
  const items = useCart((s) => s.items);
  const queryClient = useQueryClient();
  const ids = Object.keys(items);
  if (ids.length === 0) return null;

  const products = cachedProductMap(queryClient);
  let total = 0;
  for (const id of ids) {
    const p = products.get(id);
    if (p) total += p.price_iqd * (items[id] ?? 0);
  }
  const totalLabel = formatIQD(total);

  return (
    <Pressable
      testID="cart-bar"
      accessibilityRole="button"
      accessibilityLabel={ar.catalog.viewCartA11y(ids.length, totalLabel)}
      onPress={onPress}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      <View style={styles.start}>
        <View style={styles.count}>
          <AppText weight="bold" size="small" color={colors.primary}>
            {String(ids.length)}
          </AppText>
        </View>
        <AppText weight="semibold" color={colors.surface}>
          {ar.catalog.viewCart}
        </AppText>
      </View>
      <AppText weight="bold" color={colors.surface}>
        {totalLabel}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    start: spacing.lg,
    end: spacing.lg,
    bottom: spacing.sm,
    height: sizes.primaryButton,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    elevation: 4,
    shadowColor: colors.text,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  pressed: { backgroundColor: colors.primaryPressed },
  start: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: {
    minWidth: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});
