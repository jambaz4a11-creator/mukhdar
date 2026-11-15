// فحص مساحة اللمس (مراجعة S6): الارتفاع (height أو minHeight) + hitSlop العمودي ≥ 44.
import { StyleSheet, type ViewStyle } from 'react-native';
import { sizes } from '../theme';

/** عنصر من screen.getBy… (نأخذ props فقط) */
type Element = { props: Record<string, unknown> };

type Slop = number | { top?: number; bottom?: number } | undefined;

export function touchHeight(element: Element): number {
  const style = StyleSheet.flatten(element.props.style as ViewStyle) ?? {};
  const base = Math.max(
    typeof style.height === 'number' ? style.height : 0,
    typeof style.minHeight === 'number' ? style.minHeight : 0,
  );
  const slop = element.props.hitSlop as Slop;
  const extra = typeof slop === 'number' ? slop * 2 : (slop?.top ?? 0) + (slop?.bottom ?? 0);
  return base + extra;
}

export function expectTouchTarget(element: Element): void {
  expect(touchHeight(element)).toBeGreaterThanOrEqual(sizes.touchTarget);
}
