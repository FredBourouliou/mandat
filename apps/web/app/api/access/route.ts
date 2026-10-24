import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, checkCode, clientIp } from '@/lib/access';
import { consume } from '@/lib/db';

export async function POST(req: Request) {
  if (!consume(`access:${await clientIp()}`, 20) || !consume('access-global', 300)) return NextResponse.json({ error: 'Too many attempts today.' }, { status: 429 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const token = checkCode(String(code ?? ''));
  if (!token) return NextResponse.json({ error: 'This access code is not valid.' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 60 });
  return res;
}
