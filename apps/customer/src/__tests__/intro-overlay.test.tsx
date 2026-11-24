import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  INTRO_TOTAL_MS,
  IntroOverlay,
  resetIntroForTests,
  shouldPlayIntro,
} from '../components/IntroOverlay';

beforeEach(() => {
  resetIntroForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe('IntroOverlay (T46)', () => {
  it('لا تُعرض تلقائياً أثناء الاختبارات الآلية', async () => {
    expect(shouldPlayIntro()).toBe(false);
    await render(<IntroOverlay />);
    expect(screen.queryByTestId('intro-overlay')).toBeNull();
  });

  it('تظهر ويُنهيها لمس التخطي', async () => {
    await render(<IntroOverlay enabled />);
    expect(screen.getByTestId('intro-overlay')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('intro-skip'));
    expect(screen.queryByTestId('intro-overlay')).toBeNull();
  });

  it('تُتجاوز مع تقليل الحركة', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<IntroOverlay enabled />);
    await act(async () => {});
    expect(screen.queryByTestId('intro-overlay')).toBeNull();
  });

  it('مدتها ≤ ثانيتين وتنتهي وحدها', async () => {
    expect(INTRO_TOTAL_MS).toBeLessThanOrEqual(2000);
    jest.useFakeTimers();
    try {
      await render(<IntroOverlay enabled />);
      await act(async () => {});
      await act(async () => {
        jest.advanceTimersByTime(INTRO_TOTAL_MS + 500);
      });
      expect(screen.queryByTestId('intro-overlay')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
