// أدوات مشتركة لاختبارات PWA السائق.
import type { Page } from '@playwright/test';

/** يجمع أخطاء CSP وأخطاء الصفحة غير الملتقطة (تُفحص بنهاية الاختبار). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text))
      errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** يحاكي التطبيق المثبَّت (navigator.standalone + display-mode: standalone) قبل تحميل أي سكربت. */
export async function simulateInstalled(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes('display-mode: standalone')
        ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
        : original(query);
  });
}
