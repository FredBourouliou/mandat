import 'server-only';
import { approvalHash, buyerSignature, mandateChallenge, mandateHash, type Mandate } from '@mandat/guard';
import { agentEvents, getSession, guardFor } from './store';
import { disputesFor } from './disputes';
import { SIGNER } from './env';

export const running = new Set<string>();

/** Everything the session page shows, in one read. */
export function sessionState(id: string) {
  const row = getSession(id);
  const guard = guardFor(id);
  if (!row || !guard) return null;
  const mandate = JSON.parse(row.mandate) as Mandate;
  const buyer = buyerSignature(guard.ledger.entries, guard.hash, SIGNER);
  const mandateSigned = guard.ledger.entries.some(e => e.type === 'mandate.signed');
  const signedOrders = new Set(guard.ledger.entries.filter(e => e.type === 'approval.signed').map(e => (e.data as { orderId: string }).orderId));
  // On a signed mandate the PayPal link appears only once the passkey has signed that exact order.
  const orders = guard.orders.map((o): (typeof guard.orders)[number] & { approvalChallenge?: string } => (
    o.state === 'awaiting_approval' && mandateSigned && !signedOrders.has(o.orderId)
      ? { ...o, approveUrl: undefined, approvalChallenge: mandateChallenge(approvalHash({ mandateHash: guard.hash, orderId: o.orderId, amount: o.amount })) }
      : o
  ));
  return {
    id,
    createdAt: row.created_at,
    mandate,
    mandateHash: mandateHash(mandate),
    buyer,
    spent: guard.spent,
    ledger: guard.ledger.entries,
    orders,
    agent: agentEvents(id),
    running: running.has(id),
    disputes: disputesFor(id).map(d => ({
      id: d.id, orderId: d.order_id, captureId: d.capture_id, createdAt: d.created_at,
      view: d.view ? JSON.parse(d.view) : null,
      draft: d.draft ? JSON.parse(d.draft) : null,
      response: d.response ? JSON.parse(d.response) : null,
      simulatedOutcome: d.simulated_outcome,
      firstWebhookAt: d.first_webhook_at,
    })),
  };
}
/** As served to the page: `live` says whether this browser may act (jury access code) or only replay. */
export type SessionState = NonNullable<ReturnType<typeof sessionState>> & { live: boolean };
