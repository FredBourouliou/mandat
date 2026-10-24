import { NextResponse } from 'next/server';
import { verifyReceipt, type SealedReceipt } from '@mandat/guard';
import { signingKey } from '@/lib/env';

/** Verifies a sealed receipt against this deployment's public key. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ valid: false, reason: 'receipt too large' }, { status: 413 });
  let receipt: SealedReceipt;
  try { receipt = JSON.parse(raw); } catch { return NextResponse.json({ valid: false, reason: 'not valid JSON' }); }
  const key = signingKey();
  if (!Array.isArray(receipt?.entries) || typeof receipt.signature !== 'string') return NextResponse.json({ valid: false, reason: 'not a Mandat receipt' });
  if (receipt.keyId !== key.keyId) return NextResponse.json({ valid: false, reason: `unknown key ${String(receipt.keyId)}` });
  try {
    return NextResponse.json({ ...verifyReceipt(receipt, key.publicKey), keyId: key.keyId, entries: receipt.entries.length });
  } catch {
    return NextResponse.json({ valid: false, reason: 'malformed receipt' });
  }
}
