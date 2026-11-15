import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @mukhdar/shared مصدر TypeScript (بلا build)
  transpilePackages: ['@mukhdar/shared'],
  poweredByHeader: false,
};

export default nextConfig;
