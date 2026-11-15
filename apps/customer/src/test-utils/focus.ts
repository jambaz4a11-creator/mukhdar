// بديل useFocusEffect من expo-router للاختبارات (مراجعة S3): يستدعي الدالة عند التركيب كالتركيز الأول،
// وrefocus() يحاكي الرجوع للشاشة.
import { useEffect } from 'react';

const callbacks = new Set<() => void>();

export function mockFocusEffect(callback: () => void): void {
  useEffect(() => {
    callbacks.add(callback);
    callback();
    return () => {
      callbacks.delete(callback);
    };
  }, [callback]);
}

export function refocus(): void {
  for (const callback of [...callbacks]) callback();
}
