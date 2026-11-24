// مقدمة الشعار (T46): العربة تدخل بسرعة مع خطوط السرعة، تكبح وتستقر، ثم يتلاشى الغلاف. ≤ 1.8 ثانية.
// بُنيت بالكود من الشعار (صور شفافة عالية الدقة) لا من فيديو: حادة على كل الشاشات ولا تُثقل الحزمة.
// قواعدها: مرة واحدة لكل تشغيل، تخطٍّ بلمسة، تُتجاوز مع "تقليل الحركة"، ولا تؤخر شيئاً: التطبيق يعمل تحتها
// أصلاً (الغلاف فقط فوقه) وأي لمسة تُنهيها. تُتجاوز بالاختبارات الآلية (jest وPlaywright) كي لا تبتلع النقرات.
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { ar } from '../i18n/ar';
import { colors } from '../theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CART = require('../../assets/intro/intro-cart.png') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LINES = require('../../assets/intro/intro-lines.png') as number;

export const INTRO_TOTAL_MS = 1800;
// مساحة المشهد بإحداثيات الشعار الأصلي (1024): x 120..910، y 225..825
const SCENE = { w: 790, h: 600 };
const CART_BOX = { left: 70, top: 0, w: 720, h: 600 };
const LINES_BOX = { left: 0, top: 275, w: 280, h: 205 };

let played = false;

/** هل تُعرض المقدمة هذا التشغيل؟ (مرة واحدة، ولا أتمتة) */
export function shouldPlayIntro(): boolean {
  if (played) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.webdriver)
    return false;
  return true;
}

export function resetIntroForTests() {
  played = false;
}

export function IntroOverlay({ enabled = shouldPlayIntro() }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(enabled);
  const { width } = useWindowDimensions();
  const cartX = useRef(new Animated.Value(SCENE.w * 0.7)).current;
  const linesOpacity = useRef(new Animated.Value(0)).current;
  const linesScale = useRef(new Animated.Value(0.4)).current;
  const bounce = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    played = true;
    setVisible(false);
  };

  useEffect(() => {
    if (!enabled) return;
    played = true; // مرة واحدة لكل تشغيل حتى لو أُعيد تركيب المكوّن
    let cancelled = false;
    let anim: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          finish();
          return;
        }
        const nd = Platform.OS !== 'web';
        anim = Animated.sequence([
          Animated.parallel([
            // دخول سريع ثم كبح (تباطؤ حاد) عند الاستقرار
            Animated.timing(cartX, {
              toValue: 0,
              duration: 800,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: nd,
            }),
            Animated.timing(linesOpacity, { toValue: 1, duration: 250, useNativeDriver: nd }),
            Animated.timing(linesScale, {
              toValue: 1,
              duration: 500,
              easing: Easing.out(Easing.quad),
              useNativeDriver: nd,
            }),
            Animated.sequence([
              Animated.delay(600),
              // ارتداد خفيف عند التوقف
              Animated.timing(bounce, { toValue: 1.04, duration: 120, useNativeDriver: nd }),
              Animated.spring(bounce, {
                toValue: 1,
                friction: 4,
                tension: 160,
                useNativeDriver: nd,
              }),
            ]),
          ]),
          Animated.delay(300),
          Animated.parallel([
            Animated.timing(linesOpacity, { toValue: 0, duration: 250, useNativeDriver: nd }),
            Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: nd }),
          ]),
        ]);
        anim.start(({ finished }) => {
          if (finished) finish();
        });
      });
    return () => {
      cancelled = true;
      anim?.stop();
    };
    // تُشغَّل مرة عند التركيب فقط
  }, []);

  if (!visible) return null;

  const boxW = Math.min(width * 0.78, 340);
  const k = boxW / SCENE.w;
  const px = (n: number) => n * k;

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} testID="intro-overlay">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel={ar.intro.skip}
        testID="intro-skip"
      />
      <Animated.View
        pointerEvents="none"
        style={{ width: boxW, height: px(SCENE.h), transform: [{ scale: bounce }] }}
      >
        {/* العربة والخطوط طبقة واحدة تتحرك معاً (لا خط فاصل بينهما)؛ الخطوط تتمدد من طرفها الملاصق للعربة */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: Animated.multiply(cartX, k) }] },
          ]}
        >
          <Animated.Image
            source={LINES}
            accessibilityIgnoresInvertColors
            style={{
              position: 'absolute',
              left: px(LINES_BOX.left),
              top: px(LINES_BOX.top),
              width: px(LINES_BOX.w),
              height: px(LINES_BOX.h),
              opacity: linesOpacity,
              transform: [
                { translateX: px(LINES_BOX.w / 2) },
                { scaleX: linesScale },
                { translateX: -px(LINES_BOX.w / 2) },
              ],
            }}
          />
          <Animated.Image
            source={CART}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            style={{
              position: 'absolute',
              left: px(CART_BOX.left),
              top: px(CART_BOX.top),
              width: px(CART_BOX.w),
              height: px(CART_BOX.h),
            }}
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
