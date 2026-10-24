import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, hasLiveAccess } from '@/lib/access';
import { consume } from '@/lib/db';
import { DEMO_MERCHANT } from '@/lib/catalog';
import { createSession } from '@/lib/store';

const Body = z.object({
  purpose: z.string().trim().min(3).max(120),
  maxTotal: z.number().int().min(1000).max(20000),
  maxPerPurchase: z.number().int().min(1000).max(20000),
  approvalAbove: z.number().int().min(0).max(20000),
  maxPurchases: z.number().int().min(1).max(10),
  days: z.number().int().min(1).max(30),
});

/** Creates a demo mandate. Amounts are in euro cents, capped at 200 EUR (sandbox). */
export async function POST(req: Request) {
  if (!(await hasLiveAccess())) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!consume(`session:${await clientIp()}`, 20)) return NextResponse.json({ error: 'Daily limit reached for new mandates.' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid mandate.' }, { status: 400 });
  const b = parsed.data;
  const eur = (minor: number) => ({ currency: 'EUR', minor });
  const now = new Date();
  const id = createSession({
    principal: 'demo-buyer',
    purpose: b.purpose,
    merchants: [DEMO_MERCHANT.id],
    categories: ['outdoor', 'travel'],
    maxTotal: eur(b.maxTotal),
    maxPerPurchase: eur(Math.min(b.maxPerPurchase, b.maxTotal)),
    approvalAbove: eur(b.approvalAbove),
    maxPurchases: b.maxPurchases,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + b.days * 864e5).toISOString(),
  });
  return NextResponse.json({ id });
}
