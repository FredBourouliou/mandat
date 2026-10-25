import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Guard, buyerSignature, mandateChallenge, mandateHash, verifyMandateSignature,
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
    expect(verifyMandateSignature(authenticator().assert(HASH), HASH, ORIGIN)).toEqual({ valid: true });
  });

  it('accepts an Ed25519 assertion', () => {
    expect(verifyMandateSignature(authenticator('ed25519').assert(HASH), HASH, ORIGIN)).toEqual({ valid: true });
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
    expect(verifyMandateSignature(sig, HASH, ORIGIN).valid).toBe(false);
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
    expect(buyerSignature(g.ledger.entries, g.hash, ORIGIN)).toMatchObject({ status: 'signed', credentialId: 'cred-1', userVerified: true });
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
