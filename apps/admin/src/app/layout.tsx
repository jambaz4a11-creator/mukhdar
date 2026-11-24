import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'لوحة سوق بسماوي', template: '%s · لوحة سوق بسماوي' },
  robots: { index: false, follow: false },
  // T44: قابلة للتثبيت على الشاشة الرئيسية (Web Push على الآيفون يحتاجه). manifest من app/manifest.ts
  applicationName: 'لوحة سوق بسماوي',
  appleWebApp: { capable: true, title: 'لوحة سوق بسماوي', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F6B3A',
};

// T23 F L2: CSP بـ nonce لكل طلب (proxy.ts) يتطلب عرض كل صفحة ديناميكياً: الصفحة المبنية مسبقاً (static) لا تحمل
// الـ nonce فيحجب المتصفح كل سكربتاتها ('strict-dynamic' يتجاهل 'self'). الصفحات العامة (/privacy، /terms،
// /delete-account، /not-authorized، 404) كانت static؛ الآن كلها تُعرض بالطلب وتحمل الـ nonce.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
