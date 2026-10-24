// Live sandbox check of the guard + PayPal rail (J2). Needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.
// Run: node scripts/sandbox-e2e.ts
import { Guard, PayPalRail, mandateHash, generateSigningKey, verifyReceipt, type Mandate } from '../src/index.ts';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const rail = new PayPalRail({
  clientId: env('PAYPAL_CLIENT_ID'), clientSecret: env('PAYPAL_CLIENT_SECRET'),
  returnUrl: 'https://example.com/mandat-return', cancelUrl: 'https://example.com/mandat-return?cancel=1',
});
const now = new Date();
const mandate: Mandate = {
  id: `mdt_${now.getTime()}`, principal: 'sandbox-e2e', purpose: 'Hiking gear for a trip',
  merchants: ['atelier-voyage'], categories: ['outdoor'],
  maxPerPurchase: { currency: 'EUR', minor: 15000 }, maxTotal: { currency: 'EUR', minor: 20000 },
  approvalAbove: { currency: 'EUR', minor: 8000 }, maxPurchases: 3,
  validFrom: new Date(now.getTime() - 60_000).toISOString(), validUntil: new Date(now.getTime() + 7 * 864e5).toISOString(),
};
const g = new Guard(mandate, rail);
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'OK ' : 'KO '} ${label}`); if (!ok) process.exitCode = 1; };
const item = (id: string, minor: number, extra = {}) => ({ id, mandateId: mandate.id, merchant: 'atelier-voyage', sku: id, title: `Item ${id}`, category: 'outdoor', quantity: 1, unitPrice: { currency: 'EUR', minor }, reason: 'e2e', ...extra });

const small = await g.submit(item('pack', 6000));
check('direct path paid', small.status === 'paid');
const again = await g.submit(item('pack', 6000));
check('resubmission returns the same order', again.status === 'paid' && small.status === 'paid' && again.orderId === small.orderId);
if (small.status === 'paid') {
  const o = await rail.getOrder(small.orderId);
  check('PayPal order custom_id = mandate hash', o.purchase_units?.[0]?.custom_id === mandateHash(mandate));
  const t = await rail.addTracking(small.orderId, small.captureId!, 'Colissimo', `6A${Date.now()}`.slice(0, 13), `trk-${small.orderId}`);
  const after = await rail.getOrder(small.orderId);
  const trackers = after.purchase_units?.[0]?.shipping?.trackers ?? [];
  check('tracking attached and visible on the PayPal order', Boolean(t) && trackers.length > 0);
  g.record('shipment.tracked', { orderId: small.orderId, carrier: 'Colissimo' });
}
const blocked = await g.submit(item('suite', 90000, { merchant: 'luxury-suites' }));
check('out-of-mandate purchase denied (no PayPal call)', blocked.status === 'denied');
const big = await g.submit(item('tent', 12000));
check('above threshold → PayPal approval link', big.status === 'awaiting_approval' && big.approveUrl.includes('paypal.com'));
const key = generateSigningKey('e2e');
check('sealed receipt verifies', verifyReceipt(g.ledger.seal(key), key.publicKey).valid);
console.log('ledger entries:', g.ledger.entries.map(e => e.type).join(' → '));
if (big.status === 'awaiting_approval') console.log('approval link (optional manual check):', big.approveUrl);
