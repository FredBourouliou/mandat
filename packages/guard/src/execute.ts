import { sha256Hex } from './canonical.ts';
import { evaluate, mandateHash, type Decision, type Mandate, type Money, type Proposal } from './mandate.ts';
import { Ledger } from './receipt.ts';

/** The payment rail the guard drives. The PayPal implementation lives in ./paypal.ts. */
export interface PaymentRail {
  /** mode "direct": pay and capture now. mode "approval": return a link the human must approve. */
  createOrder(input: {
    requestId: string;
    customId: string;
    description: string;
    amount: Money;
    mode: 'direct' | 'approval';
  }): Promise<{ orderId: string; status: string; approveUrl?: string; captureId?: string }>;
  captureOrder(orderId: string, requestId: string): Promise<{ status: string; captureId?: string; payerId?: string }>;
}

export type Outcome =
  | { status: 'denied'; reasons: string[] }
  | { status: 'paid'; orderId: string; captureId?: string; amount: Money }
  | { status: 'awaiting_approval'; orderId: string; approveUrl: string; amount: Money; reasons: string[] }
  | { status: 'failed'; orderId?: string; reason: string };

interface Purchase {
  proposal: Proposal;
  amount: Money;
  orderId: string;
  state: 'awaiting_approval' | 'paid';
  outcome: Outcome;
}

/** Idempotency key derived from the mandate and the proposal: the same proposal can never create two orders. */
export function requestIdFor(mandateId: string, proposalId: string, step: string): string {
  return sha256Hex(`${mandateId}:${proposalId}:${step}`);
}

/**
 * Holds the only authority to spend under a mandate. The agent proposes; the guard
 * evaluates deterministically, executes through the rail, and records every step.
 */
export class Guard {
  readonly ledger: Ledger;
  readonly hash: string;
  readonly mandate: Mandate;
  private readonly rail: PaymentRail;
  private readonly clock: () => Date;
  private readonly purchases = new Map<string, Purchase>();
  /** Operations run one at a time, so two concurrent proposals can never both pass the cumulative check. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(mandate: Mandate, rail: PaymentRail, clock: () => Date = () => new Date()) {
    this.mandate = mandate;
    this.rail = rail;
    this.clock = clock;
    this.hash = mandateHash(mandate);
    this.ledger = new Ledger(this.hash);
    this.ledger.append('mandate.issued', { mandate, mandateHash: this.hash }, clock());
  }

  /** Spending counts paid purchases and those reserved while awaiting approval. */
  get spent(): { count: number; total: Money } {
    let minor = 0;
    for (const p of this.purchases.values()) minor += p.amount.minor;
    return { count: this.purchases.size, total: { currency: this.mandate.maxTotal.currency, minor } };
  }

  submit(proposal: Proposal): Promise<Outcome> {
    return this.exclusive(() => this.submitNow(proposal));
  }

  /** Called when the human comes back from the PayPal approval page. */
  completeApproval(proposalId: string): Promise<Outcome> {
    return this.exclusive(() => this.completeApprovalNow(proposalId));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async submitNow(proposal: Proposal): Promise<Outcome> {
    const existing = this.purchases.get(proposal.id);
    if (existing) return existing.outcome;

    const now = this.clock();
    this.ledger.append('proposal.received', { proposal }, now);
    const decision: Decision = evaluate(this.mandate, proposal, this.spent, now);
    this.ledger.append('decision', decision, now);
    if (decision.kind === 'deny') return { status: 'denied', reasons: decision.reasons };

    const mode = decision.kind === 'allow' ? 'direct' : 'approval';
    let order;
    try {
      order = await this.rail.createOrder({
        requestId: requestIdFor(this.mandate.id, proposal.id, 'create'),
        customId: this.hash,
        description: `${proposal.title} x${proposal.quantity}`.slice(0, 127),
        amount: decision.amount,
        mode,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.ledger.append('order.failed', { proposalId: proposal.id, reason }, this.clock());
      return { status: 'failed', reason };
    }
    this.ledger.append('order.created', { proposalId: proposal.id, ...order, mode }, this.clock());

    let outcome: Outcome;
    if (mode === 'direct') {
      outcome = { status: 'paid', orderId: order.orderId, captureId: order.captureId, amount: decision.amount };
    } else if (order.approveUrl) {
      outcome = { status: 'awaiting_approval', orderId: order.orderId, approveUrl: order.approveUrl, amount: decision.amount, reasons: decision.kind === 'needs_approval' ? decision.reasons : [] };
    } else {
      return { status: 'failed', orderId: order.orderId, reason: 'no approval link returned' };
    }
    this.purchases.set(proposal.id, { proposal, amount: decision.amount, orderId: order.orderId, state: mode === 'direct' ? 'paid' : 'awaiting_approval', outcome });
    return outcome;
  }

  private async completeApprovalNow(proposalId: string): Promise<Outcome> {
    const p = this.purchases.get(proposalId);
    if (!p) return { status: 'failed', reason: 'unknown proposal' };
    if (p.state === 'paid') return p.outcome;
    const cap = await this.rail.captureOrder(p.orderId, requestIdFor(this.mandate.id, proposalId, 'capture'));
    this.ledger.append('order.captured', { proposalId, orderId: p.orderId, ...cap }, this.clock());
    if (cap.status !== 'COMPLETED') return { status: 'failed', orderId: p.orderId, reason: `capture status ${cap.status}` };
    p.state = 'paid';
    p.outcome = { status: 'paid', orderId: p.orderId, captureId: cap.captureId, amount: p.amount };
    return p.outcome;
  }

  record(type: string, data: unknown): void {
    this.ledger.append(type, data, this.clock());
  }
}
