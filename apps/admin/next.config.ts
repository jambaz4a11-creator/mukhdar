import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './src/lib/security';

const nextConfig: NextConfig = {
  // @mukhdar/shared مصدر TypeScript (بلا build)
  transpilePackages: ['@mukhdar/shared'],
  poweredByHeader: false,
  // T23 M3: ترويسات الأمان لكل المسارات. Content-Security-Policy (بـ nonce لكل طلب) يضيفه src/proxy.ts.
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default nextConfig;
