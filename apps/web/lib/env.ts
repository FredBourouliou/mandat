import 'server-only';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { loadSigningKey, PayPalClient, type SigningKey } from '@mandat/guard';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data');
mkdirSync(DATA_DIR, { recursive: true });

export const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const JURY_CODE = process.env.JURY_CODE ?? '';
export const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID ?? '';

export const paypalCredentials = () => ({ clientId: required('PAYPAL_CLIENT_ID'), clientSecret: required('PAYPAL_CLIENT_SECRET') });

let client: PayPalClient | undefined;
export function paypal(): PayPalClient {
  return (client ??= new PayPalClient(paypalCredentials()));
}

let key: SigningKey | undefined;
/** Ed25519 receipt key: from SIGNING_KEY_PEM in production, generated once into DATA_DIR in development. */
export function signingKey(): SigningKey {
  if (key) return key;
  const keyId = process.env.SIGNING_KEY_ID ?? 'mandat-dev';
  let pem = process.env.SIGNING_KEY_PEM?.replace(/\\n/g, '\n');
  if (!pem) {
    const file = join(DATA_DIR, 'signing-key.pem');
    if (!existsSync(file)) {
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    pem = readFileSync(file, 'utf8');
  }
  return (key = loadSigningKey(keyId, pem));
}
