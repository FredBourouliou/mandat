import 'server-only';
import { cookies, headers } from 'next/headers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DEMO_SESSION_ID, JURY_CODE } from './env';

export const ACCESS_COOKIE = 'mandat_access';
const token = (code: string) => createHash('sha256').update(`mandat-access:${code}`).digest('base64url');

// A production server without JURY_CODE stays closed instead of opening every live route.
const OPEN_WITHOUT_CODE = process.env.NODE_ENV !== 'production';

/** Live calls (Claude, PayPal) need the jury access code. Without JURY_CODE set (local development), access is open. */
export async function hasLiveAccess(): Promise<boolean> {
  if (!JURY_CODE) return OPEN_WITHOUT_CODE;
  const value = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!value) return false;
  const a = Buffer.from(value), b = Buffer.from(token(JURY_CODE));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The recorded demo is what every visitor sees: nobody can act on it, access code or not. */
export const isDemo = (sessionId: string) => Boolean(DEMO_SESSION_ID) && sessionId === DEMO_SESSION_ID;

/** May this browser act on this session (run the agent, propose, approve, open or answer a dispute)? */
export async function canAct(sessionId: string): Promise<boolean> {
  return !isDemo(sessionId) && (await hasLiveAccess());
}

export function checkCode(code: string): string | null {
  if (!JURY_CODE) return OPEN_WITHOUT_CODE ? token('') : null;
  const a = Buffer.from(code.trim()), b = Buffer.from(JURY_CODE);
  return a.length === b.length && timingSafeEqual(a, b) ? token(JURY_CODE) : null;
}

/**
 * Client IP for rate limits: the right-most X-Forwarded-For hop, added by Render's proxy. Earlier hops and
 * CF-Connecting-IP pass through as the client sent them (tested on the deployment, 24/10/2026).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local';
}
