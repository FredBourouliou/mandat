import { NextResponse } from 'next/server';
import { buyerSignature, verifyReceipt, type SealedReceipt } from '@mandat/guard';
import { SIGNER, signingKey } from '@/lib/env';

/** Verifies a sealed receipt against this deployment's public key, and the buyer's passkey signature on the mandate. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ valid: false, reason: 'receipt too large' }, { status: 413 });
  let receipt: SealedReceipt;
  try { receipt = JSON.parse(raw); } catch { return NextResponse.json({ valid: false, reason: 'not valid JSON' }); }
  const key = signingKey();
  if (!Array.isArray(receipt?.entries) || typeof receipt.signature !== 'string') return NextResponse.json({ valid: false, reason: 'not a Mandat receipt' });
  if (receipt.keyId !== key.keyId) return NextResponse.json({ valid: false, reason: `unknown key ${String(receipt.keyId)}` });
  try {
    const seal = verifyReceipt(receipt, key.publicKey);
    // A buyer signature is only reported inside a receipt this deployment sealed: otherwise anyone could post a
    // forged receipt and get a green "Signed" line next to "Receipt rejected".
    if (!seal.valid) return NextResponse.json({ ...seal, seal: false, keyId: key.keyId, entries: receipt.entries.length });
    const buyer = buyerSignature(receipt.entries, receipt.mandateHash, SIGNER);
    const result = seal.valid && buyer.status === 'invalid' ? { valid: false, reason: `buyer signature: ${buyer.reason}` } : seal;
    return NextResponse.json({ ...result, seal: seal.valid, buyer, keyId: key.keyId, entries: receipt.entries.length });
  } catch {
    return NextResponse.json({ valid: false, reason: 'malformed receipt' });
  }
}
