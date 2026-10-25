import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canAct } from '@/lib/access';
import { consume } from '@/lib/db';
import { openDispute } from '@/lib/disputes';

/** Sandbox: a chargeback is opened on one of the session's paid orders. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await canAct(id))) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  const parsed = z.object({ orderId: z.string().min(5).max(40) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose an order.' }, { status: 400 });
  if (!consume(`dispute:${id}`, 3)) return NextResponse.json({ error: 'Dispute limit reached for this mandate.' }, { status: 429 });
  try {
    return NextResponse.json({ disputeId: await openDispute(id, parsed.data.orderId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'PayPal refused the chargeback.' }, { status: 502 });
  }
}
