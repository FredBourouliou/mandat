import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Guard, generateSigningKey, verifyReceipt,
  type Mandate, type PaymentRail, type Proposal,
} from '../src/index.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const eur = (minor: number) => ({ currency: 'EUR', minor });
const MERCHANTS = ['atelier-voyage', 'luxury-suites', 'gadget-hub'];
const CATEGORIES = ['outdoor', 'travel', 'electronics', 'gift-cards'];

/** Any mandate the form could produce, and more: limits from 0.01 EUR, thresholds above the limits, a window around now. */
const mandateArb: fc.Arbitrary<Mandate> = fc.record({
  maxPerPurchase: fc.integer({ min: 1, max: 30000 }),
  maxTotal: fc.integer({ min: 1, max: 60000 }),
  approvalAbove: fc.integer({ min: 0, max: 40000 }),
  maxPurchases: fc.integer({ min: 1, max: 6 }),
  categories: fc.subarray(CATEGORIES, { minLength: 1 }),
  startsInDays: fc.integer({ min: -10, max: 2 }),
  lastsDays: fc.integer({ min: 1, max: 30 }),
}).map(m => ({
  id: 'mdt_p', principal: 'p', purpose: 'property test', merchants: ['atelier-voyage'], categories: m.categories,
  maxPerPurchase: eur(m.maxPerPurchase), maxTotal: eur(m.maxTotal), approvalAbove: eur(m.approvalAbove), maxPurchases: m.maxPurchases,
  validFrom: new Date(NOW.getTime() + m.startsInDays * 864e5).toISOString(),
  validUntil: new Date(NOW.getTime() + (m.startsInDays + m.lastsDays) * 864e5).toISOString(),
}));

/**
 * What a hijacked agent could propose: any merchant, category, currency, price, quantity, even nonsense.
 * Weighted towards plausible small purchases, so sequences often reach the count and total limits.
 */
const proposalArb = (i: number): fc.Arbitrary<Proposal> => fc.record({
  merchant: fc.oneof({ arbitrary: fc.constant('atelier-voyage'), weight: 3 }, { arbitrary: fc.constantFrom(...MERCHANTS), weight: 1 }),
  category: fc.oneof({ arbitrary: fc.constantFrom('outdoor', 'travel'), weight: 3 }, { arbitrary: fc.constantFrom(...CATEGORIES), weight: 1 }),
  currency: fc.constantFrom('EUR', 'EUR', 'EUR', 'USD'),
  unit: fc.oneof(
    { arbitrary: fc.integer({ min: 1, max: 3000 }), weight: 4 },
    { arbitrary: fc.integer({ min: 1, max: 40000 }), weight: 2 },
    { arbitrary: fc.constantFrom(0, -500, 0.5, 1e9), weight: 1 },
  ),
  quantity: fc.oneof({ arbitrary: fc.integer({ min: 1, max: 5 }), weight: 4 }, { arbitrary: fc.constantFrom(0, -1, 1.5), weight: 1 }),
  otherMandate: fc.integer({ min: 0, max: 9 }).map(n => n === 0),
}).map(p => ({
  id: `prp_${i}`, mandateId: p.otherMandate ? 'mdt_other' : 'mdt_p', merchant: p.merchant, sku: 'sku', title: 'item',
  category: p.category, quantity: p.quantity, unitPrice: { currency: p.currency, minor: p.unit }, reason: 'because',
}));

const proposalsArb = fc.integer({ min: 1, max: 12 }).chain(n => fc.tuple(...Array.from({ length: n }, (_, i) => proposalArb(i))));

function countingRail() {
  const orders: { requestId: string; amount: number; mode: string }[] = [];
  const rail: PaymentRail = {
    async createOrder({ requestId, amount, mode }) {
      orders.push({ requestId, amount: amount.minor, mode });
      const orderId = `ORD-${orders.length}`;
      return mode === 'direct' ? { orderId, status: 'COMPLETED', captureId: `CAP-${orders.length}` } : { orderId, status: 'PAYER_ACTION_REQUIRED', approveUrl: `https://approve/${orderId}` };
    },
    async captureOrder(orderId) { return { status: 'COMPLETED', captureId: `CAP-${orderId}`, payerId: 'B' }; },
  };
  return { rail, orders };
}

/** Every order the rail saw must fit the mandate, whatever was proposed. */
function checkInvariants(m: Mandate, g: Guard, orders: { amount: number; mode: string }[]) {
  const total = orders.reduce((t, o) => t + o.amount, 0);
  expect(total).toBeLessThanOrEqual(m.maxTotal.minor);
  expect(orders.length).toBeLessThanOrEqual(m.maxPurchases);
  for (const o of orders) {
    expect(o.amount).toBeGreaterThan(0);
    expect(o.amount).toBeLessThanOrEqual(m.maxPerPurchase.minor);
    if (o.amount > m.approvalAbove.minor) expect(o.mode).toBe('approval');
  }
  for (const o of g.orders) {
    expect(m.merchants).toContain(o.proposal.merchant);
    expect(m.categories).toContain(o.proposal.category);
    expect(o.amount.currency).toBe('EUR');
  }
  const inWindow = NOW >= new Date(m.validFrom) && NOW <= new Date(m.validUntil);
  if (!inWindow) expect(orders).toHaveLength(0);
  expect(g.spent.total.minor).toBe(total);
}

describe('guard properties (fast-check)', () => {
  it('never lets an order outside the mandate reach PayPal, for any sequence of proposals', async () => {
    await fc.assert(fc.asyncProperty(mandateArb, proposalsArb, async (m, proposals) => {
      const { rail, orders } = countingRail();
      const g = new Guard(m, rail, () => NOW);
      for (const p of proposals) await g.submit(p);
      checkInvariants(m, g, orders);
    }), { numRuns: 500 });
  });

  it('keeps the same limits when the proposals arrive concurrently', async () => {
    await fc.assert(fc.asyncProperty(mandateArb, proposalsArb, async (m, proposals) => {
      const { rail, orders } = countingRail();
      const g = new Guard(m, rail, () => NOW);
      await Promise.all(proposals.map(p => g.submit(p)));
      checkInvariants(m, g, orders);
    }), { numRuns: 300 });
  });

  it('creates at most one order per proposal, however often it is resubmitted', async () => {
    await fc.assert(fc.asyncProperty(mandateArb, proposalsArb, fc.array(fc.nat(), { minLength: 1, maxLength: 20 }), async (m, proposals, picks) => {
      const { rail, orders } = countingRail();
      const g = new Guard(m, rail, () => NOW);
      for (const k of picks) await g.submit(proposals[k % proposals.length]!);
      expect(new Set(orders.map(o => o.requestId)).size).toBe(orders.length);
    }), { numRuns: 300 });
  });

  it('rebuilds the same state from its ledger', async () => {
    await fc.assert(fc.asyncProperty(mandateArb, proposalsArb, async (m, proposals) => {
      const { rail } = countingRail();
      const g = new Guard(m, rail, () => NOW);
      for (const p of proposals) await g.submit(p);
      const r = Guard.restore(m, rail, structuredClone(g.ledger.entries), () => NOW);
      expect(r.spent).toEqual(g.spent);
      expect(r.orders).toEqual(g.orders);
    }), { numRuns: 200 });
  });

  it('rejects a sealed receipt after any change to any entry', async () => {
    const key = generateSigningKey('k');
    await fc.assert(fc.asyncProperty(mandateArb, proposalsArb, fc.nat(), fc.constantFrom('at', 'type', 'data', 'swap'), async (m, proposals, which, field) => {
      const { rail } = countingRail();
      const g = new Guard(m, rail, () => NOW);
      for (const p of proposals) await g.submit(p);
      const receipt = g.ledger.seal(key);
      expect(verifyReceipt(receipt, key.publicKey).valid).toBe(true);
      const i = which % receipt.entries.length;
      const e = receipt.entries[i]!;
      if (field === 'at') e.at = new Date(Date.parse(e.at) + 1000).toISOString();
      else if (field === 'type') e.type = `${e.type}.x`;
      else if (field === 'data') e.data = { ...(e.data as object), forged: true };
      else if (receipt.entries.length > 1) {
        const j = (i + 1) % receipt.entries.length;
        [receipt.entries[i], receipt.entries[j]] = [receipt.entries[j]!, receipt.entries[i]!];
      } else e.data = { forged: true };
      expect(verifyReceipt(receipt, key.publicKey).valid).toBe(false);
    }), { numRuns: 300 });
  });
});
