// صورة المنتج بـ expo-image (تخزين على القرص). بدون صورة: بديل بأول حرف من الاسم وأيقونة ورقة
// (docs/design/README.md: الصور مؤقتة حتى تتوفر صور حقيقية).
// fit="contain" (بطاقة المنتج، 2026-11-18): الصورة كاملة بلا قص على خلفية بيضاء، والبديل على خلفية محايدة.
import Ionicons from '@expo/vector-icons/Ionicons';
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
  /** cover (الافتراضي): تملأ المربع؛ contain: كاملة بلا قص على خلفية بيضاء */
  fit?: 'cover' | 'contain';
  accessibilityLabel?: string;
  testID?: string;
}

export function ProductImage({
  name,
  imagePath,
  style,
  letterSize = 36,
  dimmed = false,
  fit = 'cover',
  accessibilityLabel,
  testID,
}: Props) {
  const uri = productImageUrl(getSupabase(), imagePath);
  const contain = fit === 'contain';
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };
  const background = contain
    ? uri
      ? colors.surface
      : colors.divider
    : dimmed
      ? colors.divider
      : colors.primarySoft;
  const letterColor = dimmed ? colors.textMuted : contain ? colors.textMuted : colors.primary;

  return (
    <View {...a11y} testID={testID} style={[styles.box, { backgroundColor: background }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, dimmed && styles.dimmed]}
          contentFit={fit}
          contentPosition="center"
          cachePolicy="memory-disk"
          transition={150}
          recyclingKey={imagePath}
          testID={testID ? `${testID}-photo` : undefined}
        />
      ) : (
        <View style={styles.placeholder} testID={testID ? `${testID}-placeholder` : undefined}>
          {contain ? <Ionicons name="leaf-outline" size={22} color={colors.border} /> : null}
          <AppText
            style={{ fontFamily: fonts.bold, fontSize: letterSize, lineHeight: letterSize * 1.4 }}
            color={letterColor}
          >
            {name.trim().charAt(0)}
          </AppText>
        </View>
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
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
});
