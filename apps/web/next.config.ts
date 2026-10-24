import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@mandat/guard'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  agentRules: false,
};

export default config;
