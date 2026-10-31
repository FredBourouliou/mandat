import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyApproval, type MandateSignature } from '@mandat/guard';
import { canAct } from '@/lib/access';
import { SIGNER } from '@/lib/env';
import { guardFor, saveLedger } from '@/lib/store';

const Body = z.object({
  orderId: z.string().min(5).max(40),
  authenticatorData: z.string().max(4000),
  clientDataJSON: z.string().max(4000),
  signature: z.string().max(1400),
});

/** The passkey that signed the mandate signs one order above the threshold; only then is the PayPal link released. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await canAct(id))) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  const { orderId, ...assertion } = parsed.data;
  const guard = guardFor(id);
  const order = guard?.orders.find(o => o.orderId === orderId && o.state === 'awaiting_approval');
  if (!guard || !order?.approveUrl) return NextResponse.json({ error: 'This order is not waiting for approval.' }, { status: 409 });
  const mandateSig = guard.ledger.entries.find(e => e.type === 'mandate.signed')?.data as MandateSignature | undefined;
  if (!mandateSig) return NextResponse.json({ error: 'This mandate is not signed.' }, { status: 409 });
  const approval = { orderId, signature: { ...mandateSig, ...assertion } };
  const r = verifyApproval(guard.ledger.entries, guard.hash, approval, SIGNER);
  if (!r.valid) return NextResponse.json({ error: `Passkey signature rejected: ${r.reason}.` }, { status: 400 });
  if (!guard.ledger.entries.some(e => e.type === 'approval.signed' && (e.data as { orderId?: string }).orderId === orderId)) {
    guard.record('approval.signed', approval);
    saveLedger(id, guard);
  }
  return NextResponse.json({ approveUrl: order.approveUrl });
}
