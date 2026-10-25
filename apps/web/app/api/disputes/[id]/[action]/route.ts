import { NextResponse } from 'next/server';
import { canAct } from '@/lib/access';
import { consume } from '@/lib/db';
import { claudeErrorMessage } from '@/lib/errors';
import { disputeSession, draftResponse, knownDispute, refreshDispute, simulateOutcome, submitResponse } from '@/lib/disputes';

export const maxDuration = 60;

/** refresh | draft | submit | outcome */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  if (!knownDispute(id)) return NextResponse.json({ error: 'Unknown dispute.' }, { status: 404 });
  if (!(await canAct(disputeSession(id)))) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  try {
    switch (action) {
      case 'refresh': return NextResponse.json({ view: await refreshDispute(id) });
      case 'draft':
        if (!consume(`draft:${id}`, 4)) return NextResponse.json({ error: 'Draft limit reached for this dispute.' }, { status: 429 });
        try { return NextResponse.json({ draft: await draftResponse(id) }); } catch (e) { return NextResponse.json({ error: claudeErrorMessage(e) }, { status: 502 }); }
      case 'submit': {
        const { action: used } = await submitResponse(id);
        if (!used) return NextResponse.json({ error: 'PayPal has not opened a response window yet. It usually does within a minute or two.' }, { status: 409 });
        return NextResponse.json({ action: used });
      }
      case 'outcome': simulateOutcome(id); return NextResponse.json({ ok: true });
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 502 });
  }
}
