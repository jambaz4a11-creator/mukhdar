// شريط الأقسام الأفقي: "الكل" ثم الأقسام بترتيبها. المختار أخضر ممتلئ.
import { ScrollView, Pressable, StyleSheet } from 'react-native';
import type { Category } from '../features/catalog/api';
import { ar } from '../i18n/ar';
import { colors, radius, sizes, spacing } from '../theme';
import { AppText } from './AppText';

interface Props {
  categories: Category[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

export function CategoryChips({ categories, selected, onSelect }: Props) {
  const chips: { id: number | null; label: string }[] = [
    { id: null, label: ar.catalog.all },
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={ar.catalog.categoriesLabel}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {chips.map((c) => {
        const active = c.id === selected;
        return (
          <Pressable
            key={c.id ?? 'all'}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(c.id)}
            style={[styles.chip, active ? styles.active : styles.idle]}
          >
            <AppText
              size="small"
              weight={active ? 'semibold' : 'medium'}
              color={active ? colors.surface : colors.text}
            >
              {c.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: spacing.xs, paddingHorizontal: spacing.screen, paddingBottom: spacing.md },
  chip: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: 18,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  idle: { backgroundColor: colors.surface, borderColor: colors.border },
});
