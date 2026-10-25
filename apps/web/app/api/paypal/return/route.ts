import { NextResponse } from 'next/server';
import { canAct } from '@/lib/access';
import { PUBLIC_URL } from '@/lib/env';
import { guardFor, railFor, saveLedger } from '@/lib/store';
import { ship } from '@/lib/merchant';

/** The buyer comes back from PayPal: capture the approved order (once), ship it, return to the session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('s') ?? '';
  const orderId = url.searchParams.get('token') ?? '';
  const back = `${PUBLIC_URL}/s/${encodeURIComponent(sessionId)}`;
  const guard = guardFor(sessionId);
  const order = guard?.orders.find(o => o.orderId === orderId);
  if (!guard || !order || !(await canAct(sessionId))) return NextResponse.redirect(back);
  if (url.searchParams.get('cancel')) {
    // The URL alone proves nothing: record a cancellation only if PayPal confirms the order was not approved, and only once.
    const status = await railFor(sessionId).getOrder(orderId).then(o => o.status as string, () => 'UNKNOWN');
    const already = guard.ledger.entries.some(e => e.type === 'approval.cancelled' && (e.data as { orderId?: string }).orderId === orderId);
    if (order.state === 'awaiting_approval' && status === 'PAYER_ACTION_REQUIRED' && !already) {
      guard.record('approval.cancelled', { orderId, proposalId: order.proposal.id, paypalStatus: status });
      saveLedger(sessionId, guard);
    }
    return NextResponse.redirect(`${back}?approval=cancelled`);
  }
  const outcome = await guard.completeApproval(order.proposal.id).catch(e => ({ status: 'failed' as const, reason: String(e) }));
  saveLedger(sessionId, guard);
  if (outcome.status === 'paid' && outcome.captureId) await ship(sessionId, guard, outcome.orderId, outcome.captureId).catch(() => undefined);
  return NextResponse.redirect(`${back}?approval=${outcome.status === 'paid' ? 'captured' : 'failed'}`);
}
