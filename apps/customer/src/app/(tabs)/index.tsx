// الرئيسية والكتالوج (T11، SPEC-customer §2.2، تصميم Home): "التوصيل إلى" (T12)، بحث، شريط "المتجر مغلق"، الأقسام،
// شبكة عمودين بتمرير لانهائي (30 بالصفحة)، سحب للتحديث، وشريط السلة العائم.
import { errorMessage } from '@mukhdar/shared';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { CART_BAR_SPACE, CartBar } from '../../components/CartBar';
import { CategoryChips } from '../../components/CategoryChips';
import { DeliveryAddressHeader } from '../../components/DeliveryAddressHeader';
import { CARD_HEIGHT, ProductCard } from '../../components/ProductCard';
import { SearchBox } from '../../components/SearchBox';
import { StoreClosedBanner } from '../../components/StoreClosedBanner';
import type { Product } from '../../features/catalog/api';
import { useCategories, useProductSearch, useProducts } from '../../features/catalog/hooks';
import { useCart } from '../../features/cart/store';
import { useAppSettings } from '../../features/settings/useAppSettings';
import { ar } from '../../i18n/ar';
import { getSupabase } from '../../lib/supabase';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { colors, radius, sizes, spacing } from '../../theme';

export const SEARCH_DEBOUNCE_MS = 300;
const ROW_HEIGHT = CARD_HEIGHT + spacing.md;
/** عنوان القائمة بارتفاع ثابت حتى تبقى إزاحات getItemLayout صحيحة */
const HEADING_HEIGHT = 40;

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {getSupabase() === null ? <NotConfigured /> : <Catalog />}
    </SafeAreaView>
  );
}

function NotConfigured() {
  return (
    <View style={styles.padded}>
      <AppText weight="bold" size="display" color={colors.primary}>
        {ar.home.title}
      </AppText>
      <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
        <AppText color={colors.warningText}>{ar.home.notConfigured}</AppText>
      </View>
    </View>
  );
}

function Catalog() {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const searching = term !== '';

  const categories = useCategories();
  const settings = useAppSettings();
  const list = useProducts(categoryId);
  const results = useProductSearch(term);
  const hasCart = useCart((s) => Object.keys(s.items).length > 0);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const cardWidth = (width - spacing.screen * 2 - spacing.md) / 2;

  const products: Product[] = searching ? (results.data ?? []) : (list.data?.pages.flat() ?? []);
  const active = searching ? results : list;

  const openProduct = useCallback((p: Product) => {
    router.push({ pathname: '/product/[id]', params: { id: p.id } });
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([active.refetch(), categories.refetch(), settings.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const onEndReached = () => {
    if (!searching && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  const heading = searching
    ? ar.catalog.searchResults
    : categoryId === null
      ? ar.catalog.allProducts
      : (categories.data?.find((c) => c.id === categoryId)?.name ?? ar.catalog.allProducts);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.topRow}>
          <DeliveryAddressHeader />
          <AppText weight="bold" size="heading" color={colors.primary} accessibilityRole="header">
            {ar.home.title}
          </AppText>
        </View>
        <SearchBox value={search} onChange={setSearch} />
      </View>

      <StoreClosedBanner />

      {!searching && (
        <CategoryChips
          categories={categories.data ?? []}
          selected={categoryId}
          onSelect={setCategoryId}
        />
      )}

      <FlatList
        style={styles.flex}
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[
          styles.listContent,
          hasCart && { paddingBottom: CART_BAR_SPACE + spacing.lg },
        ]}
        renderItem={({ item }) => (
          <View style={{ width: cardWidth }}>
            <ProductCard product={item} onOpen={openProduct} />
          </View>
        )}
        // بطاقات بارتفاع ثابت: الفهرس هنا فهرس الصف (عمودان بالصف)
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: HEADING_HEIGHT + ROW_HEIGHT * index,
          index,
        })}
        ListHeaderComponent={
          <AppText
            weight="bold"
            size="title"
            numberOfLines={1}
            style={styles.heading}
            accessibilityRole="header"
          >
            {heading}
          </AppText>
        }
        ListEmptyComponent={
          <ListState
            pending={active.isPending && active.fetchStatus !== 'idle'}
            error={active.isError ? active.error : null}
            onRetry={() => void active.refetch()}
            emptyText={searching ? ar.catalog.noResults(term) : ar.catalog.noProducts}
            emptyHint={searching ? ar.catalog.noResultsHint : undefined}
          />
        }
        ListFooterComponent={
          list.isFetchingNextPage && !searching ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : undefined
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />

      <CartBar onPress={() => router.navigate('/cart')} />
    </View>
  );
}

function ListState({
  pending,
  error,
  onRetry,
  emptyText,
  emptyHint,
}: {
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  emptyText: string;
  emptyHint?: string;
}) {
  if (pending) {
    return (
      <View style={styles.state} accessibilityLabel={ar.home.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
        <AppText color={colors.danger}>{errorMessage(error)}</AppText>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <AppText weight="semibold" color={colors.primary}>
            {ar.home.retry}
          </AppText>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.state} testID="catalog-empty">
      <AppText weight="semibold" style={styles.center}>
        {emptyText}
      </AppText>
      {emptyHint ? (
        <AppText muted size="small" style={styles.center}>
          {emptyHint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  padded: { padding: spacing.screen, gap: spacing.lg },
  header: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heading: { height: HEADING_HEIGHT, lineHeight: 28, paddingBottom: spacing.md },
  listContent: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, flexGrow: 1 },
  columns: { gap: spacing.md, marginBottom: spacing.md },
  footer: { paddingVertical: spacing.lg },
  state: { paddingVertical: 48, alignItems: 'center', gap: spacing.xs },
  center: { textAlign: 'center' },
  banner: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  retry: { minHeight: sizes.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
});
