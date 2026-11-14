// ترجمة أخطاء الدخول والتسجيل بخريطة واحدة (T10، ADR 0001). المصادر:
// - GoTrue (signInWithPassword): error.code مثل invalid_credentials، أو status 429.
// - Edge Function signup: جسم الرد {"error": CODE} (يُقرأ بـ parseFunctionError قبل التمرير هنا).
// لا يعرض للمستخدم نص الخطأ الخام أبداً.
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  isErrorCode,
} from './errors';
import { PIN_MESSAGES } from './pin';

export const AUTH_MESSAGES = {
  INVALID_CREDENTIALS: 'الرقم أو الرمز غير صحيح',
  PHONE_TAKEN: ERROR_MESSAGES.PHONE_TAKEN,
  RATE_LIMITED: ERROR_MESSAGES.RATE_LIMITED,
  PIN_LENGTH: PIN_MESSAGES.PIN_LENGTH,
} as const;

export type AuthErrorKind =
  'invalid_credentials' | 'phone_taken' | 'rate_limited' | 'weak_pin' | 'network' | 'other';

export interface AuthError {
  kind: AuthErrorKind;
  message: string;
}

const NETWORK_PATTERN =
  /failed to fetch|network request failed|networkerror|load failed|fetch failed/i;

function field(error: unknown, name: string): unknown {
  return typeof error === 'object' && error !== null && name in error
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

/**
 * يحوّل خطأ Auth أو رمز دالة signup (نصاً، أو {error: CODE}، أو BackendError {code}) لرسالة عربية
 * ونوع (لتصرف الشاشة، مثل التحويل لوضع الدخول عند phone_taken).
 */
export function authError(error: unknown): AuthError {
  const code = [
    typeof error === 'string' ? error : undefined,
    field(error, 'code'),
    field(error, 'error_code'),
    field(error, 'error'),
  ].find((v): v is string => typeof v === 'string' && v !== '');
  const status = field(error, 'status');
  const name = field(error, 'name');
  const message = field(error, 'message');

  switch (code) {
    case 'invalid_credentials':
      return { kind: 'invalid_credentials', message: AUTH_MESSAGES.INVALID_CREDENTIALS };
    case 'PHONE_TAKEN':
    case 'user_already_exists':
    case 'phone_exists':
      return { kind: 'phone_taken', message: AUTH_MESSAGES.PHONE_TAKEN };
    case 'RATE_LIMITED':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return { kind: 'rate_limited', message: AUTH_MESSAGES.RATE_LIMITED };
    case 'weak_password':
      return { kind: 'weak_pin', message: AUTH_MESSAGES.PIN_LENGTH };
    default:
      break;
  }
  if (status === 429) return { kind: 'rate_limited', message: AUTH_MESSAGES.RATE_LIMITED };
  if (code && isErrorCode(code)) return { kind: 'other', message: ERROR_MESSAGES[code] };
  if (
    name === 'AuthRetryableFetchError' ||
    name === 'FunctionsFetchError' ||
    message === NETWORK_ERROR_MESSAGE ||
    (typeof message === 'string' && NETWORK_PATTERN.test(message))
  ) {
    return { kind: 'network', message: NETWORK_ERROR_MESSAGE };
  }
  return { kind: 'other', message: DEFAULT_ERROR_MESSAGE };
}
