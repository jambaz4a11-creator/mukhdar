// الشبكة والتركيز لـ TanStack Query (مراجعة S4، SPEC-customer §1):
// - focusManager مع AppState: الرجوع للتطبيق (active) يحدّث الاستعلامات القديمة.
// - onlineManager مع expo-network: بدون اتصال تتوقف الطلبات (fetchStatus = 'paused') وتُستأنف عند رجوعه.
// الشاشات تعرض "بدون اتصال" للاستعلام الموقوف بلا بيانات بدل مؤشر تحميل لا ينتهي.
import { type FetchStatus, focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

type NetState = { isConnected?: boolean | null; isInternetReachable?: boolean | null };

/** غير معروف (undefined/null) يُعامل كمتصل، حتى لا تتوقف الطلبات بلا سبب عند الإقلاع. */
export function isOnlineState(state: NetState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/** يُستدعى مرة عند الإقلاع (_layout). */
export function setupQueryManagers(): void {
  if (Platform.OS !== 'web') {
    focusManager.setEventListener((setFocused) => {
      const sub = AppState.addEventListener('change', (status) => setFocused(status === 'active'));
      return () => sub.remove();
    });
  }
  onlineManager.setEventListener((setOnline) => {
    let active = true;
    Network.getNetworkStateAsync()
      .then((state) => {
        if (active) setOnline(isOnlineState(state));
      })
      // تعذّرت القراءة: تبقى الحالة الافتراضية (متصل) والمستمع يصحّحها عند أول تغيير
      .catch(() => undefined);
    const sub = Network.addNetworkStateListener((state) => setOnline(isOnlineState(state)));
    return () => {
      active = false;
      sub.remove();
    };
  });
}

const subscribe = (listener: () => void) => onlineManager.subscribe(() => listener());
const getOnline = () => onlineManager.isOnline();

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnline, getOnline);
}

type QueryLike = { isPending: boolean; fetchStatus: FetchStatus };

/** أول تحميل جارٍ فعلاً (لا موقوف ولا معطّل). */
export function isFirstLoad(q: QueryLike): boolean {
  return q.isPending && q.fetchStatus === 'fetching';
}

/** بلا بيانات والطلب موقوف لانقطاع الشبكة. */
export function isOfflineEmpty(q: QueryLike): boolean {
  return q.isPending && q.fetchStatus === 'paused';
}
