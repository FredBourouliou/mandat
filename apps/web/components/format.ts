export interface Money { currency: string; minor: number }
export const money = (m?: Money | null) => (m ? `${(m.minor / 100).toFixed(2)} ${m.currency}` : '');
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const short = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n)}…` : s);

type Verdict = 'allow' | 'pending' | 'deny' | 'neutral';

/** One plain sentence and a verdict per ledger entry. */
export function describeEntry(type: string, d: any): { label: string; detail?: string; verdict?: [Verdict, string] } {
  switch (type) {
    case 'mandate.issued': return { label: 'Mandate issued', detail: d.mandate?.purpose };
    case 'mandate.signed': return { label: 'The mandate was signed with a passkey', detail: `User verification reported by the authenticator · credential ${short(String(d.credentialId), 10)}`, verdict: ['allow', 'Signed'] };
    case 'proposal.received': return { label: `Agent proposed ${d.proposal?.title} ×${d.proposal?.quantity}`, detail: `${money(d.proposal?.unitPrice)} each, sold by ${d.proposal?.merchant}. “${d.proposal?.reason}”` };
    case 'decision':
      if (d.kind === 'deny') return { label: 'Guard refused', detail: d.reasons?.join('; '), verdict: ['deny', 'Blocked'] };
      if (d.kind === 'needs_approval') return { label: `Guard asked for your approval: ${money(d.amount)}`, detail: d.reasons?.join('; '), verdict: ['pending', 'Approval'] };
      return { label: `Guard allowed ${money(d.amount)}`, detail: 'Within every limit of the mandate', verdict: ['allow', 'Allowed'] };
    case 'order.created': return { label: `PayPal order ${d.orderId} created`, detail: d.mode === 'direct' ? `Paid and captured (${d.captureId ?? d.status})` : 'Waiting for your approval in PayPal' };
    case 'order.failed': return { label: 'PayPal order failed', detail: d.reason, verdict: ['deny', 'Failed'] };
    case 'order.captured': return { label: `You approved; payment captured`, detail: `Capture ${d.captureId ?? '?'} · payer ${d.payerId ?? '?'}`, verdict: d.status === 'COMPLETED' ? ['allow', 'Paid'] : ['deny', d.status] };
    case 'approval.cancelled': return { label: 'You cancelled the approval in PayPal', verdict: ['neutral', 'Cancelled'] };
    case 'shipment.tracked': return { label: `Atelier Voyage shipped the order`, detail: `${d.carrier} ${d.trackingNumber}, tracking attached to PayPal order ${d.orderId}` };
    default: return { label: type };
  }
}
