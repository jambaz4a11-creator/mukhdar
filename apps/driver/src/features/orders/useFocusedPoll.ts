// تحديث دوري لشاشة ظاهرة (SPEC-driver §2.6/§2.7): فوراً عند الظهور، كل 30 ثانية والتطبيق بالواجهة، وعند الرجوع للتطبيق.
// يتوقف عند اختفاء الشاشة وبالخلفية. `load` لازم يكون ثابتاً (useCallback).
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { startPendingPoll } from '../auth/pendingPoll';
import { REFRESH_INTERVAL_MS } from './available';

export function useFocusedPoll(load: () => void | Promise<void>): void {
  useFocusEffect(
    useCallback(
      () => startPendingPoll(() => void load(), { intervalMs: REFRESH_INTERVAL_MS }),
      [load],
    ),
  );
}
