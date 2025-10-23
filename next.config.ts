// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Ensure these packages remain external for server components
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  },
  // In Next 16, outputFileTracingIncludes lives at the top level
  outputFileTracingIncludes: {
    'app/api/reports/personalizado/route': ['node_modules/@sparticuz/chromium/bin/**'],
    'app/api/reports/fifo/route': ['node_modules/@sparticuz/chromium/bin/**'],
    'app/api/reports/_chromium-check/route': ['node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
