// Sentry: معطّل تماماً (لا init، لا إرسال، لا wrap) إذا كان EXPO_PUBLIC_SENTRY_DSN فارغاً.
import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';
import { config } from '../config';

let enabled = false;

export function initSentry(dsn: string = config.sentryDsn): boolean {
  if (dsn.trim() === '') {
    enabled = false;
    return false;
  }
  Sentry.init({
    dsn,
    sendDefaultPii: false,
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
