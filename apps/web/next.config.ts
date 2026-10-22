import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Docker image (docker/web.Dockerfile); traced from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '../..'),
  // Shared workspace packages ship TypeScript source.
  transpilePackages: ['@crm/ui', '@crm/contracts'],
};

export default config;
