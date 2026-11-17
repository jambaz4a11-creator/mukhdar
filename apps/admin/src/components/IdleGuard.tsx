'use client';
// خمول اللوحة (T23 M7): الخادم هو من يفرض الـ 12 ساعة (touch_panel_session + current_user_role بقاعدة البيانات،
// والـ proxy عند كل تنقّل). هذا المكوّن يسجّل **النشاط الفعلي** (نقر، مفتاح، عودة للنافذة) كل 5 دقائق كحد أقصى
// حتى لا تُغلق جلسة من يعمل على صفحة مفتوحة بلا تنقّل، ويُخرج المتصفح فور أن يجيب الخادم "انتهت".
// ليس مؤقتاً بالمتصفح: لو عُطّل أو حُذف يبقى الحد مفروضاً بالخادم.
import type { MukhdarClient } from '@mukhdar/shared';
import { useEffect } from 'react';
import { LOGIN_PATH } from '@/lib/access';

export const TOUCH_EVERY_MS = 5 * 60_000;

export function IdleGuard({ supabase }: { supabase: MukhdarClient }) {
  useEffect(() => {
    // الصفحة وصلت عبر الـ proxy الذي سجّل النشاط للتو
    let last = Date.now();
    let busy = false;
    const touch = async () => {
      if (busy) return;
      busy = true;
      try {
        const { data, error } = await supabase.rpc('touch_panel_session');
        if (error) return; // انقطاع لحظي: لا نُخرج أحداً، والخادم يحكم
        if (data === false) {
          await supabase.auth.signOut({ scope: 'local' });
          window.location.assign(`${LOGIN_PATH}?reason=idle`);
          return;
        }
        last = Date.now();
      } finally {
        busy = false;
      }
    };
    const onActivity = () => {
      if (Date.now() - last >= TOUCH_EVERY_MS) void touch();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onActivity();
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase]);
  return null;
}
