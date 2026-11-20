// إشعار وصل والتطبيق مفتوح: الشاشات تتحدث فوراً (الجاهزة عند new_order، Pending عند driver_request_approved،
// طلباتي/التفاصيل عند أي تغيير) بدل انتظار الاستطلاع كل 30 ثانية. ناقل أحداث صغير بلا اعتماديات.
import { useEffect, useRef } from 'react';
import { notificationType } from './routing';

type Listener = (type: string) => void;
const listeners = new Set<Listener>();

export function emitNotification(data: unknown): void {
  const type = notificationType(data);
  if (!type) return;
  for (const l of [...listeners]) l(type);
}

/** يستدعي `cb` عند وصول إشعار من أحد `types` (أو أي نوع إن لم تُحدَّد). يُلغى عند الإزالة. */
export function useNotificationRefresh(types: readonly string[] | null, cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const listener: Listener = (type) => {
      if (!types || types.includes(type)) ref.current();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [types?.join(',')]);
}
