// AsyncStorage بذاكرة مؤقتة للاختبارات (mock الرسمي للمكتبة)
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { onlineManager } from '@tanstack/react-query';
import { configure } from '@testing-library/react-native';
import { clearTestQueryClients } from './src/test-utils/queryClient';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// findBy*/waitFor: مهلة أطول من الافتراضي (1 ثانية) لأن CI والتشغيل المتوازي أبطأ
configure({ asyncUtilTimeout: 5000 });

// T14: الإشعارات (وحدات أصلية). الاختبارات التي تحتاج سلوكاً معيناً تعيد تعريف الدوال بـ jest.mocked.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  useLastNotificationResponse: jest.fn(() => undefined),
  clearLastNotificationResponse: jest.fn(),
  AndroidImportance: { HIGH: 4 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));
jest.mock('expo-device', () => ({ __esModule: true, isDevice: false }));
// مراجعة S4: حالة الشبكة (وحدة أصلية). onlineManager يُعاد لمتصل بعد كل اختبار.
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// مراجعة S5: تفريغ QueryClients الاختبارات بعد كل اختبار (لا مؤقتات معلقة)
afterEach(() => {
  clearTestQueryClients();
  onlineManager.setOnline(true);
});
