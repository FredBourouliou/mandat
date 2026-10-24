import 'server-only';
import { mandateHash, type Mandate } from '@mandat/guard';
import { agentEvents, getSession, guardFor } from './store';
import { disputesFor } from './disputes';

export const running = new Set<string>();

/** Everything the session page shows, in one read. */
export function sessionState(id: string) {
  const row = getSession(id);
  const guard = guardFor(id);
  if (!row || !guard) return null;
  const mandate = JSON.parse(row.mandate) as Mandate;
  return {
    id,
    createdAt: row.created_at,
    mandate,
    mandateHash: mandateHash(mandate),
    spent: guard.spent,
    ledger: guard.ledger.entries,
    orders: guard.orders,
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
export type SessionState = NonNullable<ReturnType<typeof sessionState>>;
