// التبويبات تبقى مركّبة، فـ refetchOnMount لا يتكرر عند الرجوع للتبويب (مراجعة S3). هذا يحدّث عند كل
// رجوع للشاشة، ويتخطى أول تركيز لأن التركيب نفسه يطلب البيانات.
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

export function useRefetchOnFocus(refetch: () => unknown, enabled = true): void {
  const first = useRef(true);
  const latest = useRef(refetch);
  latest.current = refetch;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (enabled) void latest.current();
    }, [enabled]),
  );
}
