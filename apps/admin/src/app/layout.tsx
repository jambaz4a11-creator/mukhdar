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
  title: { default: 'لوحة المخضر', template: '%s · لوحة المخضر' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
