// Sentry: معطّل تماماً (لا init، لا إرسال، لا wrap) إذا كان EXPO_PUBLIC_SENTRY_DSN فارغاً.
import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';
import { config } from '../config';

let enabled = false;

/**
 * T23 L8: breadcrumbs الشبكة تحمل رابط الطلب كاملاً، وروابط REST بمعرّفات المستخدم بمرشّحاتها (?customer_id=eq.<uuid>).
 * نحذف سلسلة الاستعلام (والـ hash) من روابط supabase.co قبل الإرسال؛ بقية الـ breadcrumbs كما هي.
 */
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> | undefined }>(b: T): T {
  const url = b.data?.url;
  if (
    typeof url !== 'string' ||
    !/^https?:\/\/(?:[^/?#@]*\.)?supabase\.(?:co|in)(?::\d+)?(?:[/?#]|$)/i.test(url)
  ) {
    return b;
  }
  const clean = url.replace(/[?#].*$/s, '');
  return clean === url ? b : { ...b, data: { ...b.data, url: clean } };
}

export function initSentry(dsn: string = config.sentryDsn): boolean {
  if (dsn.trim() === '') {
    enabled = false;
    return false;
  }
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeBreadcrumb: scrubBreadcrumb,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? 'development' : 'production',
  });
  enabled = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** للأخطاء غير المتوقعة (SPEC-customer §1). بدون DSN: لا شيء. */
export function captureError(error: unknown): void {
  if (enabled) Sentry.captureException(error);
}

export function wrapRoot(component: ComponentType): ComponentType {
  return enabled ? Sentry.wrap(component) : component;
}
