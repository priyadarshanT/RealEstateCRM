import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship TypeScript source.
  transpilePackages: ['@crm/ui', '@crm/contracts'],
};

export default config;
