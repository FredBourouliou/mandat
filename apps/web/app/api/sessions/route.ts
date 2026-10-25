import { NextResponse } from 'next/server';
import { clientIp, hasLiveAccess } from '@/lib/access';
import { consume } from '@/lib/db';
import { buildMandate, checkSignature, MandateBody, SignatureBody, takeDraft } from '@/lib/mandates';
import { createSession } from '@/lib/store';

/**
 * Hands a mandate to the agent. Signed: the draft from /api/mandates plus the buyer's passkey assertion over its hash.
 * Unsigned: the form fields alone (no passkey available); the receipt then says the buyer did not sign.
 */
export async function POST(req: Request) {
  if (!(await hasLiveAccess())) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!consume(`session:${await clientIp()}`, 20)) return NextResponse.json({ error: 'Daily limit reached for new mandates.' }, { status: 429 });
  const body = await req.json().catch(() => null);

  const signed = SignatureBody.safeParse(body);
  if (signed.success) {
    const mandate = takeDraft(signed.data.mandateId);
    if (!mandate) return NextResponse.json({ error: 'This mandate expired. Sign it again.' }, { status: 410 });
    const sig = checkSignature(mandate, signed.data);
    if (typeof sig === 'string') return NextResponse.json({ error: `Passkey signature rejected: ${sig}.` }, { status: 400 });
    return NextResponse.json({ id: createSession(mandate, sig) });
  }

  const parsed = MandateBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid mandate.' }, { status: 400 });
  return NextResponse.json({ id: createSession(buildMandate(parsed.data)) });
}
