import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import {
  formatMoney, getDispute, receiptPdf, respondToDispute, simulateChargeback, verifyReceipt, type DisputeView,
} from '@mandat/guard';
import { db } from './db';
import { paypal, PUBLIC_URL, signingKey } from './env';
import { guardFor } from './store';

export interface DisputeRow {
  id: string; session_id: string; order_id: string; capture_id: string; created_at: string;
  view: string | null; draft: string | null; response: string | null; simulated_outcome: string | null; first_webhook_at: string | null;
}

export const DRAFT_MODEL = 'claude-sonnet-5-5';

export function disputesFor(sessionId: string): DisputeRow[] {
  return db.prepare('SELECT * FROM disputes WHERE session_id = ? ORDER BY created_at').all(sessionId) as DisputeRow[];
}

function dispute(id: string): DisputeRow {
  const row = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;
  if (!row) throw new Error('unknown dispute');
  return row;
}

/** Sandbox: the cardholder's bank charges back a paid order. */
export async function openDispute(sessionId: string, orderId: string): Promise<string> {
  const guard = guardFor(sessionId);
  const order = guard?.orders.find(o => o.orderId === orderId && o.state === 'paid' && o.captureId);
  if (!order?.captureId) throw new Error('order is not paid');
  const existing = db.prepare('SELECT id FROM disputes WHERE order_id = ?').get(orderId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = await simulateChargeback(paypal(), order.captureId, order.amount);
  db.prepare('INSERT INTO disputes (id, session_id, order_id, capture_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, orderId, order.captureId, new Date().toISOString());
  return id;
}

/** PayPal indexes new disputes with a delay; until then the dispute reads as pending. */
export async function refreshDispute(id: string): Promise<DisputeView | null> {
  try {
    const view = await getDispute(paypal(), id);
    db.prepare('UPDATE disputes SET view = ? WHERE id = ?').run(JSON.stringify(view), id);
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
  const entries = receipt.entries.map(e => `#${e.seq} ${e.at} ${e.type} ${JSON.stringify(e.data)}`).join('\n');
  const { output } = await generateText({
    model: anthropic(DRAFT_MODEL),
    output: Output.object({ schema: DraftSchema }),
    maxOutputTokens: 1500,
    system: `You write a merchant's response to a payment dispute for PayPal reviewers. Use only facts present in the ledger below; never invent facts.
Explain that the purchase was made by the buyer's AI agent under a signed spending mandate, that the guard checked it against the mandate,
which human approval or payment step happened (payer id, capture), and the shipment tracking. Mention that the receipt is hash-chained and signed (Ed25519)
and can be verified at ${PUBLIC_URL}/verify. Be concise and factual.`,
    prompt: `Dispute ${id}: stage ${view?.stage ?? 'CHARGEBACK'}, reason ${view?.reason ?? 'unknown'}, amount ${view?.amount ? formatMoney(view.amount) : 'n/a'}.
Disputed PayPal order ${row.order_id}, capture ${row.capture_id}.
Mandate hash (stored by PayPal as the order custom_id): ${guard.hash}. Receipt signature valid: ${valid}.

Ledger:
${entries}`,
  });
  db.prepare('UPDATE disputes SET draft = ? WHERE id = ?').run(JSON.stringify(output), id);
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
  // PayPal rejects PDFs with embedded files, so this copy leaves receipt.json out.
  const pdf = await receiptPdf({ receipt, mandate: guard.mandate, verifyUrl: `${PUBLIC_URL}/verify`, attachReceipt: false });
  const action = await respondToDispute(paypal(), view, {
    notes: draft.notes, pdf, tracking: tracked ? { carrier: tracked.carrier, number: tracked.trackingNumber } : undefined,
  });
  if (action) {
    db.prepare('UPDATE disputes SET response = ? WHERE id = ?').run(JSON.stringify({ action, at: new Date().toISOString(), head: receipt.head }), id);
    await refreshDispute(id);
  }
  return { action };
}

/** The sandbox cannot adjudicate chargebacks, so the final decision is simulated and labelled as such. */
export function simulateOutcome(id: string): void {
  const row = dispute(id);
  if (!row.response) throw new Error('respond first');
  db.prepare('UPDATE disputes SET simulated_outcome = ? WHERE id = ?').run('RESOLVED_SELLER_FAVOUR', id);
}
