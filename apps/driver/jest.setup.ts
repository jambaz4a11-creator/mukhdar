// إعداد Jest لتطبيق السائق: الوحدات الأصلية بدائل بالذاكرة. لا شبكة.
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { configure } from '@testing-library/react-native';
import { secureStoreMemory } from './src/test-utils/secureStoreMock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock(
  'expo-secure-store',
  () => jest.requireActual('./src/test-utils/secureStoreMock').secureStoreMock,
);
// 32 بايت حتمية افتراضياً؛ الاختبار الذي يحتاج غيرها يعيد تعريفها بـ jest.mocked
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn((n: number) =>
    Promise.resolve(Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)),
  ),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  unregisterForNotificationsAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  useLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 4 },
}));
jest.mock('expo-device', () => ({ __esModule: true, isDevice: false }));

configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  secureStoreMemory.clear();
});
