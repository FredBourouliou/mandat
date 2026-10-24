import { NextResponse } from 'next/server';
import { receiptPdf } from '@mandat/guard';
import { PUBLIC_URL, signingKey } from '@/lib/env';
import { guardFor } from '@/lib/store';

/** The sealed receipt as JSON, or as the PDF evidence pack with ?format=pdf. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardFor((await ctx.params).id);
  if (!guard) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const receipt = guard.ledger.seal(signingKey());
  if (new URL(req.url).searchParams.get('format') !== 'pdf') {
    return NextResponse.json(receipt, { headers: { 'Content-Disposition': `inline; filename="mandat-receipt-${guard.mandate.id}.json"` } });
  }
  const pdf = await receiptPdf({ receipt, mandate: guard.mandate, verifyUrl: `${PUBLIC_URL}/verify` });
  return new Response(pdf as BodyInit, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="mandat-evidence-${guard.mandate.id}.pdf"` },
  });
}
