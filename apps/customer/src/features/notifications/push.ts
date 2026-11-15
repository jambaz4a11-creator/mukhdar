// إشعارات الزبون (T14، SPEC-customer §3).
// - الإذن يُطلب بعد أول طلب ناجح فقط، مع شرح قصير (askAfterFirstOrder).
// - الرمز يُسجَّل بـ register_push_token (provider = 'expo') عند كل دخول وعند تغيّره، بشرط أن الإذن ممنوح.
// - تسجيل الخروج يحذف صف رمز هذا الجهاز (الحذف مسموح للمالك بـ RLS push_tokens_own) قبل إنهاء الجلسة.
// الإشعارات البعيدة لا تعمل في Expo Go منذ SDK 53 (Android وiOS): تحتاج development build وprojectId من EAS.
// بدونهما canUseRemotePush() = false وكل الدوال هنا لا تفعل شيئاً (لا انهيار ولا طلب إذن بلا فائدة).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MukhdarClient } from '@mukhdar/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { ar } from '../../i18n/ar';
import { captureError } from '../../lib/sentry';

export const PUSH_TOKEN_KEY = 'mukhdar.pushToken';
export const PUSH_ASKED_KEY = 'mukhdar.pushAsked';
export const ANDROID_CHANNEL_ID = 'orders';

/** إشعار يصل والتطبيق مفتوح: يظهر كبانر أيضاً. يُستدعى مرة عند تحميل الجذر. */
export function configureNotificationHandler() {
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

export function getProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export function canUseRemotePush(): boolean {
  return (
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    Device.isDevice &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
    getProjectId() !== null
  );
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  // Android 13+: القناة قبل طلب الرمز، وإلا لا يظهر طلب الإذن
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: ar.notifications.channel,
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export type RegisterResult = 'registered' | 'unsupported' | 'denied' | 'failed';

/**
 * يسجّل رمز هذا الجهاز لحساب الجلسة الحالية. ask = true يطلب الإذن إن لم يُحسم بعد؛ false = يسجّل فقط إن كان
 * ممنوحاً مسبقاً (الدخول وتغيّر الرمز، بلا نافذة إذن).
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
      projectId: getProjectId() as string,
    });
    const { error } = await client.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_provider: 'expo',
    });
    if (error) throw error;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return 'registered';
  } catch (e) {
    captureError(e);
    return 'failed';
  }
}

/** قبل تسجيل الخروج: يحذف صف رمز هذا الجهاز (لا تصل إشعارات الحساب لجهاز خرج منه). */
export async function unregisterPushToken(client: MukhdarClient): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!token) return;
    const { error } = await client.from('push_tokens').delete().eq('token', token);
    if (error) throw error;
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (e) {
    // لا يمنع الخروج. الرمز يبقى محفوظاً محلياً فيُعاد ربطه بالحساب التالي عند دخوله (upsert بالـ token).
    captureError(e);
  }
}

/**
 * بعد أول طلب ناجح: شرح قصير ثم نافذة الإذن من النظام، مرة واحدة فقط بالجهاز. إن كان الإذن محسوماً مسبقاً
 * (ممنوحاً) يسجّل الرمز بدون سؤال.
 */
export async function askAfterFirstOrder(client: MukhdarClient): Promise<void> {
  if (!canUseRemotePush()) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') {
      await registerPushToken(client, { ask: false });
      return;
    }
    if ((await AsyncStorage.getItem(PUSH_ASKED_KEY)) !== null) return;
    await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');
    Alert.alert(ar.notifications.askTitle, ar.notifications.askBody, [
      { text: ar.notifications.later, style: 'cancel' },
      {
        text: ar.notifications.enable,
        onPress: () => void registerPushToken(client, { ask: true }),
      },
    ]);
  } catch (e) {
    captureError(e);
  }
}
