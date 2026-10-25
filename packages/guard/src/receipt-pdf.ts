import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatMoney, type Mandate, type Money } from './mandate.ts';
import type { SealedReceipt } from './receipt.ts';

export interface ReceiptPdfInput {
  receipt: SealedReceipt;
  mandate: Mandate;
  verifyUrl: string;
  title?: string;
}

const INK = rgb(0.11, 0.13, 0.16);
const MUTED = rgb(0.38, 0.42, 0.47);

/**
 * Human-readable evidence pack. The sealed receipt is embedded as a JSON attachment,
 * so anyone can check the signature without trusting this PDF's text.
 */
export async function receiptPdf({ receipt, mandate, verifyUrl, title = 'Purchase mandate evidence' }: ReceiptPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Mandat');
  doc.setCreationDate(new Date(receipt.entries.at(-1)?.at ?? Date.now()));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let page = doc.addPage([595.28, 841.89]);
  let y = 800;
  const WIDTH = 495;
  // Wraps on spaces, and hard-breaks tokens (hashes, signatures) that are wider than the page.
  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const fits = (s: string) => f.widthOfTextAtSize(s, size) <= WIDTH;
    const out: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      let w = word;
      while (!fits(w)) {
        let n = w.length;
        while (n > 1 && !fits(w.slice(0, n))) n--;
        if (cur) { out.push(cur); cur = ''; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (fits(next)) cur = next; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const line = (text: string, opts: { size?: number; f?: typeof font; color?: typeof INK; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const rows = wrap(text, f, size);
    rows.forEach((row, i) => {
      if (y < 60) { page = doc.addPage([595.28, 841.89]); y = 800; }
      page.drawText(row, { x: 50, y, size, font: f, color: opts.color ?? INK });
      y -= i === rows.length - 1 ? (opts.gap ?? size + 6) : size + 3;
    });
  };

  line(title, { size: 18, f: bold, gap: 26 });
  line(`Mandate ${mandate.id} - ${mandate.purpose}`, { size: 11, f: bold });
  line(`Principal: ${mandate.principal}   Merchants: ${mandate.merchants.join(', ')}   Categories: ${mandate.categories.join(', ')}`, { color: MUTED });
  line(`Limits: ${formatMoney(mandate.maxPerPurchase)} per purchase, ${formatMoney(mandate.maxTotal)} in total, human approval above ${formatMoney(mandate.approvalAbove)}`, { color: MUTED });
  line(`Valid ${mandate.validFrom} to ${mandate.validUntil}`, { color: MUTED });
  const signed = receipt.entries.some(e => e.type === 'mandate.signed');
  line(signed
    ? 'Signed with a passkey: WebAuthn assertion over the mandate hash, user-verification flag set by the authenticator (entry #1). Mandat never holds that key.'
    : 'Not signed by the buyer: this mandate is attested by the Mandat deployment only.', { color: MUTED, gap: 22 });

  line('Event log (hash-chained)', { size: 12, f: bold, gap: 18 });
  for (const e of receipt.entries) {
    line(`${e.seq}. ${e.at}  ${e.type}  ${summarize(e.type, e.data)}`);
    line(`   hash ${e.hash}`, { size: 7, f: mono, color: MUTED, gap: 12 });
  }

  y -= 10;
  line('Seal', { size: 12, f: bold, gap: 18 });
  line(`Mandate hash (also stored by PayPal as the order custom_id): ${receipt.mandateHash}`, { size: 8, f: mono });
  line(`Head: ${receipt.head}`, { size: 8, f: mono });
  line(`Ed25519 signature (key ${receipt.keyId}): ${receipt.signature}`, { size: 7, f: mono, gap: 18 });
  line(`Verify: ${verifyUrl}  - the signed receipt is attached to this PDF as receipt.json.`, { color: MUTED });

  await doc.attach(new TextEncoder().encode(JSON.stringify(receipt, null, 2)), 'receipt.json', {
    mimeType: 'application/json',
    description: 'Sealed Mandat receipt (JCS + SHA-256 chain + Ed25519)',
  });
  return doc.save();
}

function summarize(type: string, data: unknown): string {
  const d = data as Record<string, any>;
  const money = (m?: Money) => (m ? formatMoney(m) : '');
  switch (type) {
    case 'mandate.issued': return `hash ${String(d.mandateHash).slice(0, 12)}...`;
    case 'mandate.signed': return `passkey (WebAuthn, user-verification flag set) on ${d.rpId}, credential ${String(d.credentialId).slice(0, 12)}...`;
    case 'proposal.received': return `${d.proposal?.title} x${d.proposal?.quantity} from ${d.proposal?.merchant}`;
    case 'decision': return d.kind === 'deny' ? `DENIED: ${d.reasons?.join('; ')}` : `${String(d.kind).toUpperCase()} ${money(d.amount)}`;
    case 'order.created': return `PayPal order ${d.orderId} (${d.status})`;
    case 'order.captured': return `captured ${d.captureId ?? ''} payer ${d.payerId ?? ''}`;
    case 'shipment.tracked': return `${d.carrier ?? ''} ${d.trackingNumber ?? ''}`;
    default: return '';
  }
}
