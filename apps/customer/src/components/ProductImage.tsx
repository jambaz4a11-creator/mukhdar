// صورة المنتج بـ expo-image (تخزين على القرص). بدون صورة: مربع بديل على primarySoft بأول حرف من الاسم
// (docs/design/README.md: الصور مؤقتة حتى تتوفر صور حقيقية).
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { productImageUrl } from '../features/catalog/api';
import { getSupabase } from '../lib/supabase';
import { colors, fonts, radius } from '../theme';
import { AppText } from './AppText';

interface Props {
  name: string;
  imagePath: string | null;
  style?: StyleProp<ViewStyle>;
  /** حجم الحرف بالصورة البديلة */
  letterSize?: number;
  dimmed?: boolean;
  accessibilityLabel?: string;
}

export function ProductImage({
  name,
  imagePath,
  style,
  letterSize = 36,
  dimmed = false,
  accessibilityLabel,
}: Props) {
  const uri = productImageUrl(getSupabase(), imagePath);
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };

  return (
    <View
      {...a11y}
      style={[styles.box, { backgroundColor: dimmed ? colors.divider : colors.primarySoft }, style]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, dimmed && styles.dimmed]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          recyclingKey={imagePath}
        />
      ) : (
        <AppText
          style={{ fontFamily: fonts.bold, fontSize: letterSize, lineHeight: letterSize * 1.4 }}
          color={dimmed ? colors.textMuted : colors.primary}
        >
          {name.trim().charAt(0)}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.control,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.45 },
});
