// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Ensures Next doesn't try to bundle these and allows native requires
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    // Force include Chromium brotli binaries for these route handlers
    outputFileTracingIncludes: {
      'app/api/reports/personalizado/route': ['node_modules/@sparticuz/chromium/bin/**'],
      'app/api/reports/fifo/route': ['node_modules/@sparticuz/chromium/bin/**'],
      'app/api/reports/_chromium-check/route': ['node_modules/@sparticuz/chromium/bin/**'],
    },
  },
};

export default nextConfig;
