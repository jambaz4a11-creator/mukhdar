// نص بخط التطبيق ولونه واتجاهه. كل نصوص الشاشات تمر من هنا.
import { StyleSheet, Text, type TextProps } from 'react-native';
import { colors, fonts, fontSizes } from '../theme';

type Weight = keyof typeof fonts;
type Size = keyof typeof fontSizes;

export interface AppTextProps extends TextProps {
  weight?: Weight;
  size?: Size;
  muted?: boolean;
  color?: string;
}

export function AppText({
  weight = 'regular',
  size = 'body',
  muted = false,
  color,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        styles.base,
        {
          fontFamily: fonts[weight],
          fontSize: fontSizes[size],
          color: color ?? (muted ? colors.textMuted : colors.text),
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { textAlign: 'right', writingDirection: 'rtl' },
});
