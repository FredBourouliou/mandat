// J2: purchase above the approval threshold, approved by a human on PayPal, captured by the guard,
// then sealed and rendered as a PDF evidence pack. Waits up to 15 min for the approval click.
import { writeFileSync } from 'node:fs';
import { Guard, PayPalRail, generateSigningKey, verifyReceipt, receiptPdf, type Mandate } from '../src/index.ts';

const env = (k: string) => process.env[k] ?? (() => { throw new Error(`missing ${k}`); })();
const rail = new PayPalRail({ clientId: env('PAYPAL_CLIENT_ID'), clientSecret: env('PAYPAL_CLIENT_SECRET'), returnUrl: 'https://example.com/mandat-return', cancelUrl: 'https://example.com/mandat-return?cancel=1' });
const now = new Date();
const mandate: Mandate = {
  id: `mdt_${now.getTime()}`, principal: 'sandbox-e2e', purpose: 'Hiking gear for a trip',
  merchants: ['atelier-voyage'], categories: ['outdoor'],
  maxPerPurchase: { currency: 'EUR', minor: 15000 }, maxTotal: { currency: 'EUR', minor: 20000 },
  approvalAbove: { currency: 'EUR', minor: 8000 }, maxPurchases: 3,
  validFrom: new Date(now.getTime() - 60_000).toISOString(), validUntil: new Date(now.getTime() + 7 * 864e5).toISOString(),
};
const g = new Guard(mandate, rail);
const out = await g.submit({ id: 'tent', mandateId: mandate.id, merchant: 'atelier-voyage', sku: 'tent-2p', title: 'Ultralight tent 2P', category: 'outdoor', quantity: 1, unitPrice: { currency: 'EUR', minor: 12000 }, reason: 'shelter for the trip' });
if (out.status !== 'awaiting_approval') { console.log('KO expected awaiting_approval, got', out.status); process.exit(1); }
console.log('APPROVE:', out.approveUrl);

const deadline = Date.now() + 15 * 60_000;
let status = '';
while (Date.now() < deadline) {
  status = await rail.getOrder(out.orderId).then(o => o.status, () => status);
  if (status === 'APPROVED') break;
  await new Promise(r => setTimeout(r, 5000));
}
if (status !== 'APPROVED') { console.log('KO not approved in time, status', status); process.exit(1); }
console.log('OK  approved by the buyer on PayPal');

const paid = await g.completeApproval('tent');
console.log(paid.status === 'paid' ? 'OK  captured by the guard after approval' : `KO ${JSON.stringify(paid)}`);
const capEntry = g.ledger.entries.find(e => e.type === 'order.captured');
console.log((capEntry?.data as any)?.payerId ? 'OK  payer id recorded in the ledger' : 'KO  no payer id');
const again = await g.completeApproval('tent');
console.log(again.status === 'paid' && g.ledger.entries.filter(e => e.type === 'order.captured').length === 1 ? 'OK  second completion does not capture twice' : 'KO  double capture');

const key = generateSigningKey('e2e');
const receipt = g.ledger.seal(key);
console.log(verifyReceipt(receipt, key.publicKey).valid ? 'OK  sealed receipt verifies' : 'KO  receipt invalid');
const pdf = await receiptPdf({ receipt, mandate, verifyUrl: 'https://mandat.example/verify' });
writeFileSync('scripts/out-receipt.pdf', pdf);
console.log(`OK  PDF written (${pdf.length} bytes)`);
