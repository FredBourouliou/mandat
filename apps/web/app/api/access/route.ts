import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, checkCode, clientIp } from '@/lib/access';
import { consume } from '@/lib/db';

/**
 * A correct code is always accepted, so nobody can lock the judges out. Only failures count, per IP;
 * the code (12 characters from 32) is far beyond brute force anyway.
 */
export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const token = checkCode(String(code ?? ''));
  if (!token) {
    const ok = consume(`access-fail:${await clientIp()}`, 20);
    return NextResponse.json({ error: ok ? 'This access code is not valid.' : 'Too many failed attempts today.' }, { status: ok ? 403 : 429 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 60 });
  return res;
}
