// AsyncStorage بذاكرة مؤقتة للاختبارات (mock الرسمي للمكتبة)
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { configure } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// findBy*/waitFor: مهلة أطول من الافتراضي (1 ثانية) لأن CI والتشغيل المتوازي أبطأ
configure({ asyncUtilTimeout: 5000 });
