import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Guard, anchorFor, approvalHash, buyerSignature, keyAnchored, mandateChallenge, mandateHash, payerLinks, verifyApproval, verifyMandateSignature,
  type Mandate, type MandateSignature, type PaymentRail,
} from '../src/index.ts';

const eur = (minor: number) => ({ currency: 'EUR', minor });
const mandate: Mandate = {
  id: 'mdt_1', principal: 'demo-user', purpose: 'Hiking gear', merchants: ['atelier-voyage'], categories: ['outdoor'],
  maxPerPurchase: eur(15000), maxTotal: eur(20000), approvalAbove: eur(8000), maxPurchases: 3,
  validFrom: '2026-10-30T00:00:00Z', validUntil: '2026-11-06T00:00:00Z',
};
const HASH = mandateHash(mandate);
const ORIGIN = 'https://mandat.example';
const RP = 'mandat.example';
const rail: PaymentRail = {
  async createOrder() { return { orderId: 'O1', status: 'COMPLETED', captureId: 'C1' }; },
  async captureOrder() { return { status: 'COMPLETED' }; },
};

/** A software authenticator: signs authenticatorData || SHA-256(clientDataJSON), as a passkey does. */
function authenticator(kind: 'ec' | 'ed25519' = 'ec') {
  const { privateKey, publicKey } = kind === 'ec'
    ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : generateKeyPairSync('ed25519');
  const alg = kind === 'ec' ? -7 : -8;
  return {
    publicKey,
    assert(challengeHash: string, over: { type?: string; origin?: string; rpId?: string; flags?: number; key?: KeyObject } = {}): MandateSignature {
      const client = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.get', challenge: mandateChallenge(challengeHash), origin: over.origin ?? ORIGIN }));
      const auth = Buffer.concat([createHash('sha256').update(over.rpId ?? RP).digest(), Buffer.from([over.flags ?? 0x05]), Buffer.alloc(4)]);
      const data = Buffer.concat([auth, createHash('sha256').update(client).digest()]);
      const signature = alg === -7 ? sign('sha256', data, over.key ?? privateKey) : sign(null, data, over.key ?? privateKey);
      return {
        scheme: 'webauthn', rpId: RP, origin: ORIGIN, credentialId: 'cred-1', alg,
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
        authenticatorData: auth.toString('base64url'), clientDataJSON: client.toString('base64url'), signature: signature.toString('base64url'),
      };
    },
  };
}

describe('buyer passkey signature', () => {
  it('accepts an ES256 assertion over the mandate hash', () => {
    expect(verifyMandateSignature(authenticator().assert(HASH), HASH, { origin: ORIGIN })).toEqual({ valid: true });
  });

  it('accepts an Ed25519 assertion', () => {
    expect(verifyMandateSignature(authenticator('ed25519').assert(HASH), HASH, { origin: ORIGIN })).toEqual({ valid: true });
  });

  it('rejects a signature over another mandate', () => {
    const other = mandateHash({ ...mandate, maxTotal: eur(90000) });
    expect(verifyMandateSignature(authenticator().assert(other), HASH)).toMatchObject({ valid: false, reason: 'the passkey signed another mandate' });
  });

  const rejected: [string, Parameters<ReturnType<typeof authenticator>['assert']>[1], string][] = [
    ['registration instead of assertion', { type: 'webauthn.create' }, 'not an authentication assertion'],
    ['no user verification', { flags: 0x01 }, 'user was not verified (no biometric or PIN)'],
    ['no user presence', { flags: 0x04 }, 'user was not present'],
    ['another relying party', { rpId: 'evil.example' }, 'relying party does not match'],
    ['another private key', { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }, 'passkey signature does not match'],
  ];
  for (const [name, over, reason] of rejected) {
    it(`rejects ${name}`, () => {
      expect(verifyMandateSignature(authenticator().assert(HASH, over), HASH)).toEqual({ valid: false, reason });
    });
  }

  it('rejects an assertion made on another origin than expected', () => {
    const sig = { ...authenticator().assert(HASH, { origin: 'https://phish.example' }), origin: 'https://phish.example' };
    expect(verifyMandateSignature(sig, HASH, { origin: ORIGIN }).valid).toBe(false);
  });

  it('rejects a key whose type does not match the declared algorithm', () => {
    const ed = authenticator('ed25519').assert(HASH);
    expect(verifyMandateSignature({ ...ed, alg: -7 }, HASH)).toEqual({ valid: false, reason: 'key type does not match algorithm -7' });
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    expect(verifyMandateSignature({ ...authenticator().assert(HASH), publicKey: p384 }, HASH).valid).toBe(false);
  });

  it('rejects a relying party other than the one the verifier expects', () => {
    expect(verifyMandateSignature(authenticator().assert(HASH), HASH, { rpId: 'other.example' }).valid).toBe(false);
  });

  it('rejects an assertion made inside a frame of another site', () => {
    const sig = authenticator().assert(HASH);
    const client = JSON.parse(Buffer.from(sig.clientDataJSON, 'base64url').toString());
    const forged = { ...sig, clientDataJSON: Buffer.from(JSON.stringify({ ...client, crossOrigin: true })).toString('base64url') };
    expect(verifyMandateSignature(forged, HASH)).toMatchObject({ valid: false });
  });

  it('returns a reason instead of throwing on malformed fields', () => {
    expect(verifyMandateSignature({ ...authenticator().assert(HASH), rpId: 42 as unknown as string }, HASH).valid).toBe(false);
  });

  it('rejects a client data origin that differs from the recorded one', () => {
    const sig = authenticator().assert(HASH, { origin: 'https://phish.example' });
    expect(verifyMandateSignature(sig, HASH)).toEqual({ valid: false, reason: 'origin does not match the client data' });
  });
});

describe('buyer signature in the ledger', () => {
  it('reads a signed mandate', () => {
    const g = new Guard(mandate, rail);
    g.record('mandate.signed', authenticator().assert(HASH));
    expect(buyerSignature(g.ledger.entries, g.hash, { origin: ORIGIN, rpId: RP })).toMatchObject({ status: 'signed', credentialId: 'cred-1', userVerified: true });
  });

  it('reports an unsigned mandate as such', () => {
    expect(buyerSignature(new Guard(mandate, rail).ledger.entries, HASH)).toEqual({ status: 'unsigned' });
  });

  it('rejects a ledger whose issued mandate was swapped', () => {
    const swapped = { ...mandate, maxTotal: eur(90000) };
    const g = new Guard(swapped, rail);
    g.record('mandate.signed', authenticator().assert(HASH));
    expect(buyerSignature(g.ledger.entries, HASH).status).toBe('invalid');
  });
});

describe('passkey anchored at PayPal and linked to the payer', () => {
  const expected = { origin: ORIGIN, rpId: RP };
  const proposal = { id: 'p1', mandateId: mandate.id, merchant: 'atelier-voyage', sku: 's', title: 'Jacket', category: 'outdoor', quantity: 1, unitPrice: eur(11900), reason: 'r' };
  function signedRun(key = authenticator()) {
    const created: string[] = [];
    const approvalRail: PaymentRail = {
      async createOrder(i) { created.push(i.customId); return { orderId: 'O1', status: 'PAYER_ACTION_REQUIRED', approveUrl: 'https://paypal.example/a' }; },
      async captureOrder() { return { status: 'COMPLETED', captureId: 'C1', payerId: 'PAYER1' }; },
    };
    const g = new Guard(mandate, approvalRail, () => new Date('2026-10-31T00:00:00Z'));
    const sig = key.assert(HASH);
    g.record('mandate.signed', sig);
    return { g, key, sig, created };
  }
  const hashFor = (orderId = 'O1', minor = 11900) => approvalHash({ mandateHash: HASH, orderId, amount: eur(minor) });

  it('puts the passkey fingerprint in the custom_id of a signed mandate', async () => {
    const { g, sig, created } = signedRun();
    await g.submit(proposal);
    expect(created[0]).toBe(anchorFor(HASH, sig.publicKey));
    expect(created[0]!.startsWith(HASH)).toBe(true);
    expect(created[0]!.length).toBeLessThanOrEqual(127);
    expect(keyAnchored(g.ledger.entries, HASH)).toBe('anchored');
  });

  it('notices an order that does not carry the key that signed the mandate', async () => {
    const { g } = signedRun();
    await g.submit(proposal);
    const swapped = g.ledger.entries.map(e => e.type === 'mandate.signed' ? { ...e, data: authenticator().assert(HASH) } : e);
    expect(keyAnchored(swapped, HASH)).toBe('not_anchored');
  });

  it('links the passkey to the payer PayPal reports for the order it signed', async () => {
    const { g, key } = signedRun();
    await g.submit(proposal);
    g.record('approval.signed', { orderId: 'O1', signature: key.assert(hashFor()) });
    await g.completeApproval('p1');
    expect(payerLinks(g.ledger.entries, HASH, expected)).toMatchObject([{ orderId: 'O1', status: 'linked', payerId: 'PAYER1' }]);
  });

  it('does not link a payer from a capture that failed', async () => {
    const { g, key } = signedRun();
    await g.submit(proposal);
    g.record('approval.signed', { orderId: 'O1', signature: key.assert(hashFor()) });
    g.record('order.captured', { proposalId: 'p1', orderId: 'O1', status: 'DECLINED', payerId: 'PAYER1' });
    expect(payerLinks(g.ledger.entries, HASH, expected)).toMatchObject([{ orderId: 'O1', status: 'signed' }]);
  });

  it('reports an order captured without the passkey, and one signed only after the capture', async () => {
    const { g, key } = signedRun();
    await g.submit(proposal);
    await g.completeApproval('p1');
    expect(payerLinks(g.ledger.entries, HASH, expected)).toEqual([{ orderId: 'O1', status: 'unsigned' }]);
    g.record('approval.signed', { orderId: 'O1', signature: key.assert(hashFor()) });
    expect(payerLinks(g.ledger.entries, HASH, expected)).toMatchObject([{ orderId: 'O1', status: 'invalid' }]);
  });

  it('rejects an order approval signed by another key', async () => {
    const { g } = signedRun();
    await g.submit(proposal);
    const r = verifyApproval(g.ledger.entries, HASH, { orderId: 'O1', signature: authenticator().assert(hashFor()) }, expected);
    expect(r).toEqual({ valid: false, reason: 'signed by another key than the mandate' });
  });

  it('rejects a signature over another amount or another order', async () => {
    const { g, key } = signedRun();
    await g.submit(proposal);
    expect(verifyApproval(g.ledger.entries, HASH, { orderId: 'O1', signature: key.assert(hashFor('O1', 1)) }, expected).valid).toBe(false);
    expect(verifyApproval(g.ledger.entries, HASH, { orderId: 'O1', signature: key.assert(hashFor('O2')) }, expected).valid).toBe(false);
    expect(verifyApproval(g.ledger.entries, HASH, { orderId: 'O9', signature: key.assert(hashFor('O9')) }, expected)).toEqual({ valid: false, reason: 'unknown order' });
  });
});
