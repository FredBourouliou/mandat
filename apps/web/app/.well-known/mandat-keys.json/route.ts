import { NextResponse } from 'next/server';
import { signingKey } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Public receipt-signing keys, as JWK, so anyone can verify a receipt offline. */
export function GET() {
  const k = signingKey();
  return NextResponse.json({ keys: [{ kid: k.keyId, use: 'sig', alg: 'EdDSA', ...k.publicKey.export({ format: 'jwk' }) }] });
}
