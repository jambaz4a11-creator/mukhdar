// إشعارات السائق (SPEC-driver §2.3 و§2.11، DRIVER-API §3.4 و§6).
// - الإشعارات البعيدة لا تعمل في Expo Go منذ SDK 53: تحتاج development build وprojectId من EAS؛ بدونهما
//   canUseRemotePush() = false وكل الدوال هنا لا تفعل شيئاً (لا انهيار ولا طلب إذن بلا فائدة).
// - registerPushToken: register_push_token(token, platform, 'expo') عند كل تشغيل بجلسة سائق فعّالة وبعد الدخول وتغيير
//   الرمز المؤقت (الخادم يرفض الحساب المؤشَّر بـ PIN_CHANGE_REQUIRED).
// - unregisterPushToken: يحذف صف رمز هذا الجهاز (RLS تسمح للمالك) قبل signOut: بعد إبطال الجلسة لا يمكن حذفه.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MukhdarClient } from '@mukhdar/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ar } from '../i18n/ar';

export const ANDROID_CHANNEL_ID = 'orders';
export const PUSH_TOKEN_KEY = 'mukhdar.driver.pushToken';

/** إشعار يصل والتطبيق مفتوح: يظهر كبانر أيضاً. يُستدعى مرة عند تحميل الجذر. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
}

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

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 13+: القناة قبل طلب الإذن والرمز، وإلا لا يظهر طلب الإذن
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: ar.notifications.channel,
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

/** يطلب الإذن إن لم يُحسم، ويرجع رمز Expo، أو null (للتسجيل قبل وجود حساب، SPEC-driver §2.3). */
export async function getExpoPushTokenIfAllowed(): Promise<string | null> {
  if (!canUseRemotePush()) return null;
  try {
    await ensureAndroidChannel();
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

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** لشريط "الإشعارات مطفية": denied فقط يعرض الشريط. */
export async function getPermissionState(): Promise<PermissionState> {
  if (!canUseRemotePush()) return 'unavailable';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'pin-required' | 'failed';

/**
 * يسجّل رمز هذا الجهاز لحساب الجلسة الحالية. ask = true يطلب الإذن إن لم يُحسم (بعد أول دخول)؛ false = يسجّل فقط
 * إن كان ممنوحاً (كل تشغيل). المحلي: نحفظ الرمز لنحذف صفه عند الخروج.
 */
export async function registerPushToken(
  client: MukhdarClient,
  { ask }: { ask: boolean },
): Promise<RegisterResult> {
  if (!canUseRemotePush()) return 'unsupported';
  try {
    await ensureAndroidChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return 'denied';
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: projectId() as string,
    });
    const { error } = await client.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_provider: 'expo',
    });
    if (error) {
      return /PIN_CHANGE_REQUIRED/.test(String(error.message)) ? 'pin-required' : 'failed';
    }
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return 'registered';
  } catch {
    return 'failed';
  }
}

/**
 * قبل الخروج: يحذف صف رمز هذا الجهاز. true = لا رمز لحذفه أو حُذف؛ false = فشل (الخروج لا يكمل بصمت، وإلا بقيت
 * إشعارات الحساب تصل لجهاز خرج منه).
 */
export async function unregisterPushToken(client: MukhdarClient): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!token) return true;
    const { error } = await client.from('push_tokens').delete().eq('token', token);
    if (error) return false;
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}
