import { NextResponse } from 'next/server';
import { buyerSignature, keyAnchored, payerLinks, verifyReceipt, type SealedReceipt } from '@mandat/guard';
import { paypal, SIGNER, signingKey } from '@/lib/env';

/** Asks PayPal itself: does every order still carry the custom_id the receipt says? */
async function confirmAtPayPal(entries: SealedReceipt['entries']): Promise<'confirmed' | 'mismatch' | 'unavailable'> {
  const orders = entries.filter(e => e.type === 'order.created').map(e => e.data as { orderId: string; customId?: string }).slice(0, 6);
  try {
    for (const o of orders) {
      const order = await paypal().request('GET', `/v2/checkout/orders/${encodeURIComponent(o.orderId)}`);
      if (order.purchase_units?.[0]?.custom_id !== o.customId) return 'mismatch';
    }
    return 'confirmed';
  } catch {
    return 'unavailable';
  }
}

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
    const payers = payerLinks(receipt.entries, receipt.mandateHash, SIGNER);
    const bad = payers.find(p => p.status === 'invalid');
    const anchor = keyAnchored(receipt.entries, receipt.mandateHash);
    // Only for a receipt this deployment sealed, and at most six orders.
    const atPayPal = anchor === 'anchored' ? await confirmAtPayPal(receipt.entries) : undefined;
    const final = result.valid && bad?.status === 'invalid' ? { valid: false, reason: `order approval: ${bad.reason}` }
      : result.valid && atPayPal === 'mismatch' ? { valid: false, reason: 'PayPal holds another custom_id for an order' } : result;
    return NextResponse.json({ ...final, seal: seal.valid, buyer, payers, anchor, atPayPal, keyId: key.keyId, entries: receipt.entries.length });
  } catch {
    return NextResponse.json({ valid: false, reason: 'malformed receipt' });
  }
}
