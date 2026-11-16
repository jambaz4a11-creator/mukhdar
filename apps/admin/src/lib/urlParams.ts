'use client';
// فلاتر الرابط المشتركة بين الشاشات (الطلبات، التقييمات، وأي شاشة لاحقة): M2 مراجعة C.
// القاعدة: لا نبني الرابط الجديد من لقطة العرض (useSearchParams) لأن Next يحدّثها بعد وقت؛
// نقرتان سريعتان كانتا تبدآن من نفس اللقطة القديمة فتلغي الثانية الأولى. نقرأ الرابط الحقيقي لحظة الاستدعاء
// ونكتب بـ history.replaceState (يزامنه Next مع useSearchParams).
import { useCallback } from 'react';

export type UrlPatch = Record<string, string | null>;

/** يطبّق patch على نص بحث. null أو '' يحذف المفتاح، وكذلك قيمة تساوي الافتراضي (defaults). */
export function patchSearch(
  search: string,
  patch: UrlPatch,
  defaults: Record<string, string> = {},
): string {
  const next = new URLSearchParams(search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '' || defaults[k] === v) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

/** موقع الصفحة (قابل للاستبدال بالاختبار). */
export interface UrlLocation {
  pathname: string;
  search: string;
  replace(url: string): void;
}

export const browserLocation: UrlLocation = {
  get pathname() {
    return window.location.pathname;
  },
  get search() {
    return window.location.search;
  },
  replace(url) {
    window.history.replaceState(null, '', url);
  },
};

/** يطبّق patch على الرابط الحالي فوراً ويرجع النص الجديد. */
export function applyUrlPatch(
  patch: UrlPatch,
  loc: UrlLocation = browserLocation,
  defaults: Record<string, string> = {},
): string {
  const qs = patchSearch(loc.search, patch, defaults);
  loc.replace(qs ? `${loc.pathname}?${qs}` : loc.pathname);
  return qs;
}

/** hook: دالة setParams ثابتة الهوية تقرأ الرابط لحظة الاستدعاء. */
export function useUrlParams(defaults: Record<string, string> = {}) {
  // defaults كائن ثابت عند المستدعي عادة؛ نثبّت المفتاح بنصه
  const key = JSON.stringify(defaults);
  return useCallback((patch: UrlPatch) => applyUrlPatch(patch, browserLocation, defaults), [key]);
}
