import { describe, expect, it } from 'vitest';
import {
  Guard, evaluate, generateSigningKey, mandateHash, verifyReceipt,
  type Mandate, type PaymentRail, type Proposal,
} from '../src/index.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const eur = (minor: number) => ({ currency: 'EUR', minor });

const mandate: Mandate = {
  id: 'mdt_1',
  principal: 'demo-user',
  purpose: 'Hiking gear for a trip',
  merchants: ['atelier-voyage'],
  categories: ['outdoor', 'travel'],
  maxPerPurchase: eur(15000),
  maxTotal: eur(20000),
  approvalAbove: eur(8000),
  maxPurchases: 3,
  validFrom: '2026-10-30T00:00:00Z',
  validUntil: '2026-11-06T00:00:00Z',
};

const base: Proposal = {
  id: 'prp_1', mandateId: 'mdt_1', merchant: 'atelier-voyage', sku: 'bag-30l',
  title: 'Day pack 30 L', category: 'outdoor', quantity: 1, unitPrice: eur(6000), reason: 'needed for the trip',
};
const prop = (over: Partial<Proposal>): Proposal => ({ ...base, ...over });
const none = { count: 0, total: eur(0) };

function fakeRail() {
  const created: string[] = [];
  const rail: PaymentRail = {
    async createOrder({ requestId, mode }) {
      created.push(requestId);
      const orderId = `ORD-${created.length}`;
      return mode === 'direct'
        ? { orderId, status: 'COMPLETED', captureId: `CAP-${created.length}` }
        : { orderId, status: 'PAYER_ACTION_REQUIRED', approveUrl: `https://approve/${orderId}` };
    },
    async captureOrder(orderId) {
      return { status: 'COMPLETED', captureId: `CAP-${orderId}`, payerId: 'BUYER1' };
    },
  };
  return { rail, created };
}

describe('mandate policy', () => {
  it('allows an in-mandate purchase under the approval threshold', () => {
    expect(evaluate(mandate, base, none, NOW).kind).toBe('allow');
  });

  it('asks for human approval above the threshold', () => {
    expect(evaluate(mandate, prop({ unitPrice: eur(12000) }), none, NOW).kind).toBe('needs_approval');
  });

  const outOfMandate: [string, Proposal, { count: number; total: ReturnType<typeof eur> }, Date][] = [
    ['other merchant', prop({ merchant: 'luxury-suites' }), none, NOW],
    ['other category', prop({ category: 'electronics' }), none, NOW],
    ['above per-purchase limit', prop({ unitPrice: eur(90000) }), none, NOW],
    ['quantity pushes above limit', prop({ quantity: 3 }), none, NOW],
    ['total exceeded', base, { count: 1, total: eur(15000) }, NOW],
    ['too many purchases', prop({ unitPrice: eur(100) }), { count: 3, total: eur(300) }, NOW],
    ['expired', base, none, new Date('2026-11-07T00:00:00Z')],
    ['not yet valid', base, none, new Date('2026-10-29T00:00:00Z')],
    ['other currency', prop({ unitPrice: { currency: 'USD', minor: 6000 } }), none, NOW],
    ['other mandate', prop({ mandateId: 'mdt_other' }), none, NOW],
    ['zero or negative price', prop({ unitPrice: eur(-500) }), none, NOW],
    ['fractional quantity', prop({ quantity: 0.5 }), none, NOW],
  ];
  it.each(outOfMandate)('denies: %s', (_label, p, spent, at) => {
    const d = evaluate(mandate, p, spent, at);
    expect(d.kind).toBe('deny');
  });
  it('covers 12 out-of-mandate cases', () => expect(outOfMandate).toHaveLength(12));
});

describe('guard execution', () => {
  it('creates exactly one order when the same proposal is submitted twice', async () => {
    const { rail, created } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    const a = await g.submit(base);
    const b = await g.submit(base);
    expect(created).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it('respects the cumulative limit, counting purchases awaiting approval', async () => {
    const { rail, created } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    expect((await g.submit(prop({ id: 'p1', unitPrice: eur(12000) }))).status).toBe('awaiting_approval');
    expect((await g.submit(prop({ id: 'p2', unitPrice: eur(7000) }))).status).toBe('paid');
    const third = await g.submit(prop({ id: 'p3', unitPrice: eur(2000) }));
    expect(third.status).toBe('denied');
    expect(created).toHaveLength(2);
    expect(g.spent.total.minor).toBe(19000);
  });

  it('keeps the cumulative limit when proposals arrive concurrently', async () => {
    const { rail, created } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    const results = await Promise.all(['c1', 'c2', 'c3'].map(id => g.submit(prop({ id, unitPrice: eur(7500) }))));
    expect(results.map(r => r.status)).toEqual(['paid', 'paid', 'denied']);
    expect(created).toHaveLength(2);
    expect(g.spent.total.minor).toBe(15000);
  });

  it('captures only after human approval, and only once', async () => {
    const { rail } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    await g.submit(prop({ id: 'big', unitPrice: eur(12000) }));
    const first = await g.completeApproval('big');
    const again = await g.completeApproval('big');
    expect(first.status).toBe('paid');
    expect(again).toEqual(first);
    expect(g.ledger.entries.filter(e => e.type === 'order.captured')).toHaveLength(1);
  });

  it('puts the mandate hash in the order custom_id', async () => {
    let customId = '';
    const rail: PaymentRail = {
      async createOrder(i) { customId = i.customId; return { orderId: 'O', status: 'COMPLETED', captureId: 'C' }; },
      async captureOrder() { return { status: 'COMPLETED' }; },
    };
    const g = new Guard(mandate, rail, () => NOW);
    await g.submit(base);
    expect(customId).toBe(mandateHash(mandate));
    expect(customId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('restore from ledger', () => {
  it('rebuilds spending, pending approvals and captures from the persisted ledger', async () => {
    const { rail, created } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    await g.submit(prop({ id: 'small', unitPrice: eur(5000) }));
    await g.submit(prop({ id: 'big', unitPrice: eur(12000) }));
    const r = Guard.restore(mandate, rail, JSON.parse(JSON.stringify(g.ledger.entries)), () => NOW);
    expect(r.spent).toEqual(g.spent);
    expect(r.orders.map(o => o.state)).toEqual(['paid', 'awaiting_approval']);
    expect((await r.submit(prop({ id: 'small', unitPrice: eur(5000) }))).status).toBe('paid');
    expect(created).toHaveLength(2);
    expect((await r.completeApproval('big')).status).toBe('paid');
    const again = Guard.restore(mandate, rail, r.ledger.entries, () => NOW);
    expect(again.orders.map(o => o.state)).toEqual(['paid', 'paid']);
    expect((await again.submit(prop({ id: 'third', unitPrice: eur(4000) }))).status).toBe('denied');
  });

  it('refuses a ledger that belongs to another mandate', () => {
    const { rail } = fakeRail();
    const other = new Guard({ ...mandate, id: 'mdt_2' }, rail, () => NOW);
    expect(() => Guard.restore(mandate, rail, other.ledger.entries)).toThrow();
  });
});

describe('sealed receipt', () => {
  async function sealed() {
    const { rail } = fakeRail();
    const g = new Guard(mandate, rail, () => NOW);
    await g.submit(base);
    const key = generateSigningKey('k1');
    return { receipt: g.ledger.seal(key), key };
  }

  it('verifies an untouched receipt', async () => {
    const { receipt, key } = await sealed();
    expect(verifyReceipt(receipt, key.publicKey)).toEqual({ valid: true });
  });

  it('fails when a single byte of an entry changes', async () => {
    const { receipt, key } = await sealed();
    const json = JSON.stringify(receipt).replace('"minor":6000', '"minor":6001');
    expect(json).not.toBe(JSON.stringify(receipt));
    expect(verifyReceipt(JSON.parse(json), key.publicKey).valid).toBe(false);
  });

  it('fails when an entry is removed', async () => {
    const { receipt, key } = await sealed();
    receipt.entries.splice(1, 1);
    expect(verifyReceipt(receipt, key.publicKey).valid).toBe(false);
  });

  it('fails with another signing key', async () => {
    const { receipt } = await sealed();
    expect(verifyReceipt(receipt, generateSigningKey('k2').publicKey).valid).toBe(false);
  });
});
