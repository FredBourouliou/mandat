import { NextResponse } from 'next/server';
import { mandateChallenge, mandateHash } from '@mandat/guard';
import { clientIp, hasLiveAccess } from '@/lib/access';
import { consume } from '@/lib/db';
import { buildMandate, MandateBody, RP_ID, saveDraft } from '@/lib/mandates';

/** Step 1 of a signed mandate: fixes the mandate and returns the challenge the buyer's passkey must sign (its hash). */
export async function POST(req: Request) {
  if (!(await hasLiveAccess())) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!consume(`draft:${await clientIp()}`, 40)) return NextResponse.json({ error: 'Daily limit reached for new mandates.' }, { status: 429 });
  const parsed = MandateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid mandate.' }, { status: 400 });
  const mandate = buildMandate(parsed.data);
  saveDraft(mandate);
  const hash = mandateHash(mandate);
  return NextResponse.json({ mandate, mandateHash: hash, challenge: mandateChallenge(hash), rpId: RP_ID });
}
