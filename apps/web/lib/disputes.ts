import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import {
  buyerSignature, formatMoney, getDispute, receiptPdf, respondToDispute, simulateChargeback, verifyReceipt, type DisputeView,
} from '@mandat/guard';
import { db } from './db';
import { paypal, PUBLIC_URL, SIGNER, signingKey } from './env';
import { guardFor } from './store';

export interface DisputeRow {
  id: string; session_id: string; order_id: string; capture_id: string; created_at: string;
  view: string | null; draft: string | null; response: string | null; simulated_outcome: string | null; first_webhook_at: string | null;
}

export const DRAFT_MODEL = 'claude-sonnet-5-5';

export function disputesFor(sessionId: string): DisputeRow[] {
  return db().prepare('SELECT * FROM disputes WHERE session_id = ? ORDER BY created_at').all(sessionId) as DisputeRow[];
}

const DISPUTE_ID = /^PP-[A-Z0-9-]{4,40}$/;

/** The session a dispute belongs to (the dispute must be known). */
export function disputeSession(id: string): string {
  return (db().prepare('SELECT session_id FROM disputes WHERE id = ?').get(id) as { session_id: string }).session_id;
}

/** Only disputes this app opened can be acted on. */
export function knownDispute(id: string): boolean {
  return DISPUTE_ID.test(id) && Boolean(db().prepare('SELECT 1 FROM disputes WHERE id = ?').get(id));
}

function dispute(id: string): DisputeRow {
  const row = db().prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
  if (!row) throw new Error('unknown dispute');
  return row;
}

/** Sandbox: the cardholder's bank charges back a paid order. */
export async function openDispute(sessionId: string, orderId: string): Promise<string> {
  const guard = guardFor(sessionId);
  const order = guard?.orders.find(o => o.orderId === orderId && o.state === 'paid' && o.captureId);
  if (!order?.captureId) throw new Error('order is not paid');
  // A chargeback comes from a card issuer: PayPal refuses it on an order paid from a PayPal account.
  if (order.mode !== 'direct') throw new Error('Chargebacks apply to card payments; this order was paid from a PayPal account.');
  const existing = db().prepare('SELECT id FROM disputes WHERE order_id = ?').get(orderId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = await simulateChargeback(paypal(), order.captureId, order.amount);
  db().prepare('INSERT INTO disputes (id, session_id, order_id, capture_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, orderId, order.captureId, new Date().toISOString());
  return id;
}

/** PayPal indexes new disputes with a delay; until then the dispute reads as pending. */
export async function refreshDispute(id: string): Promise<DisputeView | null> {
  if (!knownDispute(id)) return null;
  try {
    const view = await getDispute(paypal(), id);
    db().prepare('UPDATE disputes SET view = ? WHERE id = ?').run(JSON.stringify(view), id);
    return view;
  } catch {
    return null;
  }
}

function sealedFor(sessionId: string) {
  const guard = guardFor(sessionId);
  if (!guard) throw new Error('unknown session');
  const receipt = guard.ledger.seal(signingKey());
  return { guard, receipt };
}

const DraftSchema = z.object({
  summary: z.string().describe('One sentence: why the transaction was authorised and fulfilled'),
  points: z.array(z.string()).min(2).max(6).describe('Factual evidence points, each citing ledger entry numbers like (#3)'),
  notes: z.string().max(1800).describe('The note sent to PayPal with the evidence, plain text'),
});
export type Draft = z.infer<typeof DraftSchema>;

/** Claude drafts the seller's answer from the sealed receipt only; a human sends it. */
export async function draftResponse(id: string): Promise<Draft> {
  const row = dispute(id);
  const { guard, receipt } = sealedFor(row.session_id);
  const valid = verifyReceipt(receipt, signingKey().publicKey).valid;
  const view = row.view ? (JSON.parse(row.view) as DisputeView) : null;
  const buyer = buyerSignature(receipt.entries, receipt.mandateHash, SIGNER);
  // The passkey assertion is binary noise to a reader: Claude gets the verified result instead.
  const entries = receipt.entries.map(e => `#${e.seq} ${e.at} ${e.type} ${e.type === 'mandate.signed' ? JSON.stringify({ rpId: (e.data as any).rpId, credentialId: (e.data as any).credentialId }) : JSON.stringify(e.data)}`).join('\n');
  const { output } = await generateText({
    model: anthropic(DRAFT_MODEL),
    output: Output.object({ schema: DraftSchema }),
    maxOutputTokens: 1500,
    system: `You write a merchant's response to a payment dispute for PayPal reviewers. Use only facts present in the ledger below; never invent facts.
Explain that the purchase was made by the buyer's AI agent under a signed spending mandate, that the guard checked it against the mandate,
which human approval or payment step happened (payer id, capture), and the shipment tracking. If the buyer signature is verified, say that the exact mandate
was signed with a passkey (WebAuthn assertion, user-verification flag set by the authenticator) before the agent could spend, with a key Mandat does not hold; if unsigned, do not claim it. Mention that the receipt is hash-chained and signed (Ed25519)
and can be verified at ${PUBLIC_URL}/verify. Be concise and factual.`,
    prompt: `Dispute ${id}: stage ${view?.stage ?? 'CHARGEBACK'}, reason ${view?.reason ?? 'unknown'}, amount ${view?.amount ? formatMoney(view.amount) : 'n/a'}.
Disputed PayPal order ${row.order_id}, capture ${row.capture_id}.
Mandate hash (stored by PayPal as the order custom_id): ${guard.hash}. Receipt signature valid: ${valid}.
Buyer signature on the mandate: ${buyer.status === 'signed' ? 'verified passkey assertion (user-verification flag set)' : buyer.status === 'unsigned' ? 'none (unsigned mandate)' : `invalid (${buyer.reason})`}.

Ledger:
${entries}`,
  });
  db().prepare('UPDATE disputes SET draft = ? WHERE id = ?').run(JSON.stringify(output), id);
  return output;
}

/** Sends the approved draft with the PDF evidence pack through whichever action PayPal offers. */
export async function submitResponse(id: string): Promise<{ action: string | null }> {
  const row = dispute(id);
  if (!row.draft) throw new Error('draft the response first');
  if (row.response) return { action: (JSON.parse(row.response) as { action: string }).action };
  const view = await refreshDispute(id);
  if (!view) throw new Error('PayPal has not indexed this dispute yet');
  const { guard, receipt } = sealedFor(row.session_id);
  const draft = JSON.parse(row.draft) as Draft;
  const tracked = guard.ledger.entries.find(e => e.type === 'shipment.tracked' && (e.data as { orderId?: string }).orderId === row.order_id)?.data as
    { carrier: string; trackingNumber: string } | undefined;
  const pdf = await receiptPdf({ receipt, mandate: guard.mandate, verifyUrl: `${PUBLIC_URL}/verify` });
  const action = await respondToDispute(paypal(), view, {
    notes: draft.notes, pdf, tracking: tracked ? { carrier: tracked.carrier, number: tracked.trackingNumber } : undefined,
  });
  if (action) {
    db().prepare('UPDATE disputes SET response = ? WHERE id = ?').run(JSON.stringify({ action, at: new Date().toISOString(), head: receipt.head }), id);
    await refreshDispute(id);
  }
  return { action };
}

/** The sandbox cannot adjudicate chargebacks, so the final decision is simulated and labelled as such. */
export function simulateOutcome(id: string): void {
  const row = dispute(id);
  if (!row.response) throw new Error('respond first');
  db().prepare('UPDATE disputes SET simulated_outcome = ? WHERE id = ?').run('RESOLVED_SELLER_FAVOUR', id);
}
