'use client';
// خمول اللوحة (T23 M7): الخادم هو من يفرض الـ 12 ساعة (touch_panel_session + current_user_role بقاعدة البيانات،
// والـ proxy عند كل تنقّل). هذا المكوّن:
//  1) يسجّل **النشاط الفعلي** (نقر، مفتاح، عودة للنافذة) كل 5 دقائق كحد أقصى حتى لا تُغلق جلسة من يعمل على
//     صفحة مفتوحة بلا تنقّل؛
//  2) T23 F M4: يسأل الخادم كل دقيقة "هل الجلسة حيّة؟" (panel_session_alive، قراءة فقط لا تمدد الجلسة)، فاللوحة
//     المتروكة مفتوحة تخرج إلى صفحة الدخول برسالة واضحة بدل أن تعرض قوائم فارغة.
// ليس مؤقتاً بالمتصفح: لو عُطّل أو حُذف يبقى الحد مفروضاً بالخادم.
import type { MukhdarClient } from '@mukhdar/shared';
import { useEffect } from 'react';
import { isPanelSessionAlive, leaveExpiredSession } from '@/lib/panelSession';

export const TOUCH_EVERY_MS = 5 * 60_000;
export const ALIVE_POLL_MS = 60_000;

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
          await leaveExpiredSession(supabase);
          return;
        }
        last = Date.now();
      } finally {
        busy = false;
      }
    };
    const poll = async () => {
      if ((await isPanelSessionAlive(supabase)) === false) await leaveExpiredSession(supabase);
    };
    const onActivity = () => {
      if (Date.now() - last >= TOUCH_EVERY_MS) void touch();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // العودة لنافذة متروكة: تحقق أولاً (قد تكون انتهت)، ثم سجّل النشاط
      void poll().then(onActivity);
    };
    const timer = window.setInterval(() => void poll(), ALIVE_POLL_MS);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase]);
  return null;
}
