// نصوص "تنبيهات هذا الجهاز" (T44، SPEC-admin-push §4). اللوحة تجمع نصوص كل ميزة بملفها (لا i18n منفصل).
import type { PanelRole } from '@/lib/access';
import type { DeviceAlertState } from './pushClient';

export interface DeviceAlertCopy {
  status: string;
  /** الزر المتاح بهذه الحالة */
  action: 'enable' | 'disable' | null;
  help: string | null;
  tone: 'ok' | 'warn' | 'muted';
}

export const ALERTS_TITLE = 'تنبيهات هذا الجهاز';
export const ENABLE_LABEL = 'شغّل الإشعارات على هذا الجهاز';
export const DISABLE_LABEL = 'أطفئ الإشعارات';
// قرار المالك 2026-11-24 (SPEC-admin-push §9 A4): الإشعارات لا تتوقف بخروج الخمول من اللوحة
export const SESSION_NOTE =
  'الإشعارات تبقى توصلك على هذا الجهاز حتى لو انتهت جلسة اللوحة بعد 12 ساعة بلا استخدام. توقف إذا طفّيتها، أو سجّلت خروج من اللوحة، أو تغيّر حسابك (تعطيل أو تغيير دور).';
export const SOUND_LABEL = 'صوت تنبيه الطلبات الجديدة (واللوحة مفتوحة)';
export const TEST_SOUND_LABEL = 'جرّب الصوت';
export const UNLOCK_BANNER = 'صوت تنبيه الطلبات مقفول بهذا المتصفح لحد ما تضغط';
export const UNLOCK_BUTTON = 'فعّل الصوت';

export function whatArrives(role: PanelRole): string {
  return role === 'admin'
    ? 'يوصلك: طلب جديد، إلغاء الزبون لطلبه، طلب سائق جديد، ونقص المخزون.'
    : 'يوصلك: طلب جديد، إلغاء الزبون لطلبه، ونقص المخزون.';
}

export function deviceAlertCopy(state: DeviceAlertState): DeviceAlertCopy {
  switch (state) {
    case 'registered':
      return {
        status: 'الإشعارات شغّالة على هذا الجهاز',
        action: 'disable',
        help: null,
        tone: 'ok',
      };
    case 'default':
    case 'granted-unregistered':
      return {
        status: 'الإشعارات مطفية على هذا الجهاز',
        action: 'enable',
        help: null,
        tone: 'muted',
      };
    case 'denied':
      return {
        status: 'الإشعارات مرفوضة بالمتصفح',
        action: null,
        help: 'فعّلها من إعدادات الموقع بالمتصفح (أو بالآيفون: الإعدادات ← الإشعارات ← لوحة المخضر)، ثم ارجع هنا.',
        tone: 'warn',
      };
    case 'needs-install':
      return {
        status: 'على الآيفون الإشعارات تشتغل بعد إضافة اللوحة للشاشة الرئيسية',
        action: null,
        help: 'اضغط زر المشاركة ⬆️ بأسفل Safari ← "إضافة إلى الشاشة الرئيسية"، ثم افتح "لوحة المخضر" من الأيقونة وسجّل دخولك هناك.',
        tone: 'warn',
      };
    case 'ios-too-old':
      return {
        status: 'جهازك يحتاج تحديث iOS إلى 16.4 أو أحدث حتى تشتغل الإشعارات',
        action: null,
        help: null,
        tone: 'warn',
      };
    case 'not-configured':
      return {
        status: 'الإشعارات غير مهيأة على الخادم بعد',
        action: null,
        help: 'حاول لاحقاً، أو بلّغ صاحب المشروع.',
        tone: 'muted',
      };
    case 'unsupported':
    default:
      return { status: 'هذا المتصفح ما يدعم الإشعارات', action: null, help: null, tone: 'muted' };
  }
}

export function enableResultMessage(result: string): string | null {
  switch (result) {
    case 'registered':
      return null;
    case 'denied':
      return 'ما انطى المتصفح الإذن. فعّله من إعدادات الموقع وارجع جرّب.';
    case 'not-configured':
      return 'الإشعارات غير مهيأة على الخادم بعد.';
    default:
      return 'تعذّر تشغيل الإشعارات. حاول مرة ثانية.';
  }
}
