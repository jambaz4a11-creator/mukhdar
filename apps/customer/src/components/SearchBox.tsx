// حقل البحث (ارتفاع 48، زوايا 14). الـ debounce بالشاشة.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ar } from '../i18n/ar';
import { colors, fonts, fontSizes, radius, sizes } from '../theme';

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.box}>
      <Ionicons name="search" size={20} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={ar.catalog.searchLabel}
        placeholder={ar.catalog.searchPlaceholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={60}
        style={styles.input}
      />
      {value !== '' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ar.catalog.clearSearch}
          onPress={() => onChange('')}
          hitSlop={8}
          style={styles.clear}
        >
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  input: {
    flex: 1,
    height: '100%',
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingVertical: 0,
  },
  clear: {
    width: sizes.touchTarget - 12,
    height: sizes.touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
