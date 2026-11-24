// لوحة الأدمن قابلة للتثبيت (T44، SPEC-admin-push §3): /manifest.webmanifest. على الآيفون Web Push يعمل فقط للوحة
// المضافة للشاشة الرئيسية. الأيقونات = أيقونات التطبيق مؤقتاً (افتراض A8). لا offline shell (sw.js للإشعارات فقط).
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'لوحة سوق بسماوي',
    short_name: 'لوحة سوق بسماوي',
    description: 'لوحة إدارة سوق بسماوي: الطلبات والمخزون والتقارير',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F8F3',
    theme_color: '#1F6B3A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
