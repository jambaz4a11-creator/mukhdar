// مراجعة S4: الشبكة والتركيز لـ TanStack Query، وشريط بدون إنترنت.
import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfflineBanner } from '../components/OfflineBanner';
import { ar } from '../i18n/ar';
import { isFirstLoad, isOfflineEmpty, isOnlineState, setupQueryManagers } from '../lib/network';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('isOnlineState', () => {
  it('offline only when the OS says so; unknown counts as online', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({})).toBe(true);
  });
});

describe('query state helpers', () => {
  it('a paused query without data is offline, not loading', () => {
    expect(isFirstLoad({ isPending: true, fetchStatus: 'fetching' })).toBe(true);
    expect(isFirstLoad({ isPending: true, fetchStatus: 'paused' })).toBe(false);
    expect(isOfflineEmpty({ isPending: true, fetchStatus: 'paused' })).toBe(true);
    expect(isOfflineEmpty({ isPending: false, fetchStatus: 'paused' })).toBe(false);
    // معطّل (بلا جلسة مثلاً): لا تحميل ولا بدون اتصال
    expect(isFirstLoad({ isPending: true, fetchStatus: 'idle' })).toBe(false);
    expect(isOfflineEmpty({ isPending: true, fetchStatus: 'idle' })).toBe(false);
  });
});

describe('setupQueryManagers', () => {
  it('onlineManager follows expo-network (initial state and changes)', async () => {
    let listener: ((s: Network.NetworkStateEvent) => void) | null = null;
    const remove = jest.fn();
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({
      isConnected: false,
      isInternetReachable: false,
    } as Network.NetworkState);
    jest.mocked(Network.addNetworkStateListener).mockImplementationOnce((cb) => {
      listener = cb;
      return { remove } as never;
    });
    setupQueryManagers();
    await act(flush);
    expect(onlineManager.isOnline()).toBe(false);
    await act(async () => listener?.({ isConnected: true, isInternetReachable: true } as never));
    expect(onlineManager.isOnline()).toBe(true);
    await act(async () => listener?.({ isConnected: true, isInternetReachable: false } as never));
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('focusManager follows AppState (background → not focused, active → focused)', async () => {
    let onChange: ((s: AppStateStatus) => void) | null = null;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      onChange = cb as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
    setupQueryManagers();
    await act(flush); // حالة الشبكة الأولية (لا تتسرب للاختبار التالي)
    await act(async () => onChange?.('background'));
    expect(focusManager.isFocused()).toBe(false);
    await act(async () => onChange?.('active'));
    expect(focusManager.isFocused()).toBe(true);
    spy.mockRestore();
  });
});

describe('OfflineBanner', () => {
  // onlineManager يعيد تشغيل الربط عند أول مشترك، فالحالة تأتي من expo-network كما بالتطبيق
  it('hidden while online, announced as an alert when offline', async () => {
    let listener: ((s: Network.NetworkStateEvent) => void) | null = null;
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    } as Network.NetworkState);
    jest.mocked(Network.addNetworkStateListener).mockImplementation((cb) => {
      listener = cb;
      return { remove: jest.fn() } as never;
    });
    setupQueryManagers();
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 20, left: 0, right: 0, bottom: 0 },
        }}
      >
        <OfflineBanner />
      </SafeAreaProvider>,
    );
    await act(flush);
    expect(screen.getByTestId('offline-banner').props.accessibilityRole).toBe('alert');
    expect(screen.getByText(ar.offline.banner)).toBeTruthy();
    await act(async () => listener?.({ isConnected: true, isInternetReachable: true } as never));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});
