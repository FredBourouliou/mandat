import 'server-only';
import { formatMoney, type LedgerEntry, type Mandate, type Money } from '@mandat/guard';
import { db } from './db';

export interface OverviewOrder {
  at: string; item: string; minor: number; amount: string;
  authorizedBy: 'Guard alone' | 'Buyer in PayPal' | 'Passkey and PayPal';
  mandate: 'Signed' | 'Unsigned'; status: 'Paid' | 'Awaiting approval';
  orderId: string; mandateHash: string; payer: string; dispute: string;
}
export interface OverviewBlocked { at: string; item: string; minor: number; amount: string; sellers: string; rule: string; reasons: string; mandateHash: string }
export interface Overview { orders: OverviewOrder[]; blocked: OverviewBlocked[]; mandates: number }

const SESSIONS = 500;
const ruleOf = (reason: string) =>
  reason.startsWith('merchant') ? 'Merchant' : reason.startsWith('category') ? 'Category' : reason.startsWith('amount') ? 'Per-purchase limit'
  : reason.startsWith('total') ? 'Total limit' : reason.startsWith('maximum') ? 'Number of purchases' : reason.startsWith('mandate') ? 'Validity dates' : 'Other';

/** Atelier Voyage's view across every mandate, read from the sealed ledgers: orders placed by agents and what the guard refused. */
export function merchantOverview(): Overview {
  const rows = db().prepare('SELECT id, mandate, ledger FROM sessions ORDER BY created_at DESC LIMIT ?').all(SESSIONS) as { id: string; mandate: string; ledger: string }[];
  const disputes = new Map((db().prepare('SELECT order_id, response, simulated_outcome FROM disputes').all() as { order_id: string; response: string | null; simulated_outcome: string | null }[])
    .map(d => [d.order_id, d.simulated_outcome ? 'Won (simulated)' : d.response ? 'Evidence sent' : 'Open']));
  const orders: OverviewOrder[] = [];
  const blocked: OverviewBlocked[] = [];
  for (const row of rows) {
    const ledger = JSON.parse(row.ledger) as LedgerEntry[];
    const hash = (ledger[0]?.data as { mandateHash?: string })?.mandateHash ?? '';
    const signed = ledger.some(e => e.type === 'mandate.signed');
    const mandate = JSON.parse(row.mandate) as Mandate;
    let proposal: { id: string; title: string; quantity: number; merchant: string; unitPrice: Money } | undefined;
    let amount: Money | undefined;
    for (const e of ledger) {
      const d = e.data as any;
      if (e.type === 'proposal.received') { proposal = d.proposal; continue; }
      if (e.type === 'decision') {
        amount = d.amount;
        if (d.kind === 'deny' && proposal) {
          const minor = proposal.unitPrice.minor * proposal.quantity;
          blocked.push({
            at: e.at, item: `${proposal.title} ×${proposal.quantity}`, minor, amount: formatMoney({ ...proposal.unitPrice, minor }), sellers: proposal.merchant,
            rule: [...new Set((d.reasons as string[]).map(ruleOf))].join(', '), reasons: (d.reasons as string[]).join('; '), mandateHash: hash,
          });
        }
        continue;
      }
      if (e.type !== 'order.created' || !proposal || !amount || !mandate.merchants.includes(proposal.merchant)) continue;
      const captured = ledger.map(x => x.type === 'order.captured' ? x.data as { orderId?: string; payerId?: string; status?: string } : null).find(x => x?.orderId === d.orderId);
      const approvedByPasskey = ledger.some(x => x.type === 'approval.signed' && (x.data as { orderId?: string }).orderId === d.orderId);
      const paid = d.mode === 'direct' || captured?.status === 'COMPLETED';
      orders.push({
        at: e.at, item: `${proposal.title} ×${proposal.quantity}`, minor: amount.minor, amount: formatMoney(amount),
        authorizedBy: d.mode === 'direct' ? 'Guard alone' : approvedByPasskey ? 'Passkey and PayPal' : 'Buyer in PayPal',
        mandate: signed ? 'Signed' : 'Unsigned', status: paid ? 'Paid' : 'Awaiting approval',
        orderId: d.orderId, mandateHash: hash, payer: captured?.payerId ?? '', dispute: disputes.get(d.orderId) ?? '',
      });
    }
  }
  return { orders, blocked, mandates: rows.length };
}
