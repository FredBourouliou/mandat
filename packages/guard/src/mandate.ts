import { hashOf } from './canonical.ts';

/** Money in minor units (cents) to avoid floating-point errors. */
export interface Money {
  currency: string;
  minor: number;
}

/** What a human authorises an agent to buy. Immutable once issued: its hash is the reference. */
export interface Mandate {
  id: string;
  principal: string;
  purpose: string;
  merchants: string[];
  categories: string[];
  maxPerPurchase: Money;
  maxTotal: Money;
  approvalAbove: Money;
  maxPurchases: number;
  validFrom: string;
  validUntil: string;
}

/** A purchase the agent wants to make. The agent can only propose; the guard decides. */
export interface Proposal {
  id: string;
  mandateId: string;
  merchant: string;
  sku: string;
  title: string;
  category: string;
  quantity: number;
  unitPrice: Money;
  reason: string;
}

/** Purchases already executed under the mandate. */
export interface Spent {
  count: number;
  total: Money;
}

export type Decision =
  | { kind: 'allow'; amount: Money }
  | { kind: 'needs_approval'; amount: Money; reasons: string[] }
  | { kind: 'deny'; reasons: string[] };

export function mandateHash(m: Mandate): string {
  return hashOf(m);
}

export function proposalTotal(p: Proposal): Money {
  return { currency: p.unitPrice.currency, minor: p.unitPrice.minor * p.quantity };
}

export function formatMoney(m: Money): string {
  return `${(m.minor / 100).toFixed(2)} ${m.currency}`;
}

/**
 * Deterministic policy check. No model output can change the result:
 * every rule reads only the mandate, the proposal and what was already spent.
 */
export function evaluate(m: Mandate, p: Proposal, spent: Spent, now: Date): Decision {
  const reasons: string[] = [];
  const amount = proposalTotal(p);

  if (p.mandateId !== m.id) reasons.push('proposal does not reference this mandate');
  if (!Number.isInteger(p.quantity) || p.quantity < 1) reasons.push('quantity must be a positive integer');
  if (!Number.isInteger(p.unitPrice.minor) || p.unitPrice.minor <= 0) reasons.push('price must be a positive amount');
  if (amount.currency !== m.maxPerPurchase.currency) reasons.push(`currency ${amount.currency} not allowed`);

  const t = now.getTime();
  if (t < Date.parse(m.validFrom)) reasons.push('mandate not yet valid');
  if (t > Date.parse(m.validUntil)) reasons.push('mandate expired');

  if (!m.merchants.includes(p.merchant)) reasons.push(`merchant ${p.merchant} not in mandate`);
  if (!m.categories.includes(p.category)) reasons.push(`category ${p.category} not in mandate`);
  if (spent.count >= m.maxPurchases) reasons.push('maximum number of purchases reached');
  if (amount.minor > m.maxPerPurchase.minor) {
    reasons.push(`amount ${formatMoney(amount)} above per-purchase limit ${formatMoney(m.maxPerPurchase)}`);
  }
  if (spent.total.minor + amount.minor > m.maxTotal.minor) {
    reasons.push(`total would reach ${formatMoney({ ...amount, minor: spent.total.minor + amount.minor })}, above ${formatMoney(m.maxTotal)}`);
  }

  if (reasons.length > 0) return { kind: 'deny', reasons };
  if (amount.minor > m.approvalAbove.minor) {
    return { kind: 'needs_approval', amount, reasons: [`amount above ${formatMoney(m.approvalAbove)} requires human approval`] };
  }
  return { kind: 'allow', amount };
}
