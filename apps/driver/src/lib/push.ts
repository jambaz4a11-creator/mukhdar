// رمز Expo Push للتسجيل (SPEC-driver §2.3 الخطوة 2، اختياري): الإشعار عند الموافقة أفضل جهد، والاستطلاع هو الضمان.
// الإشعارات البعيدة لا تعمل في Expo Go منذ SDK 53: تحتاج development build وprojectId من EAS؛ بدونهما null بلا طلب
// إذن. أي فشل (رفض الإذن، شبكة) = null ولا يمنع التسجيل. باقي الإشعارات (القناة، register_push_token) بـ T32.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ar } from '../i18n/ar';

export const ANDROID_CHANNEL_ID = 'orders';

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export function canUseRemotePush(): boolean {
  return (
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    Device.isDevice &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
    projectId() !== null
  );
}

/** يطلب الإذن إن لم يُحسم، ويرجع رمز Expo، أو null. */
export async function getExpoPushTokenIfAllowed(): Promise<string | null> {
  if (!canUseRemotePush()) return null;
  try {
    if (Platform.OS === 'android') {
      // Android 13+: القناة قبل طلب الإذن والرمز
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: ar.notifications.channel,
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const { data } = await Notifications.getExpoPushTokenAsync({
      projectId: projectId() as string,
    });
    return data;
  } catch {
    return null;
  }
}
