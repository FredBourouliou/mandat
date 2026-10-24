import 'server-only';
import { cookies, headers } from 'next/headers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { JURY_CODE } from './env';

export const ACCESS_COOKIE = 'mandat_access';
const token = (code: string) => createHash('sha256').update(`mandat-access:${code}`).digest('base64url');

/** Live calls (Claude, PayPal) need the jury access code. Without JURY_CODE set (local development), access is open. */
export async function hasLiveAccess(): Promise<boolean> {
  if (!JURY_CODE) return true;
  const value = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!value) return false;
  const a = Buffer.from(value), b = Buffer.from(token(JURY_CODE));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkCode(code: string): string | null {
  if (!JURY_CODE) return token('');
  const a = Buffer.from(code.trim()), b = Buffer.from(JURY_CODE);
  return a.length === b.length && timingSafeEqual(a, b) ? token(JURY_CODE) : null;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}
