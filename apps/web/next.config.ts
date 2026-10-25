import type { NextConfig } from 'next';

// Everything is served from this origin (fonts are self-hosted by next/font). Next's inline bootstrap scripts and
// AG Grid's inline styles need 'unsafe-inline' without nonces; framing is refused so no page can overlay the
// "Sign with your passkey" button or an approval link (clickjacking). The dev server also needs 'unsafe-eval'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const security = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Passkeys only on this site itself; nothing else the app does not use.
  { key: 'Permissions-Policy', value: 'publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  transpilePackages: ['@mandat/guard'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: security }];
  },
};

export default config;
