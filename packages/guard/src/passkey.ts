import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { hashOf } from './canonical.ts';
import type { Money } from './mandate.ts';
import type { LedgerEntry } from './receipt.ts';

/**
 * The buyer's WebAuthn assertion over the mandate hash. The challenge the passkey signed is the
 * mandate hash itself, so the signature binds this exact mandate; Mandat's server never holds the
 * private key. Binary fields are base64url, `publicKey` is the DER SubjectPublicKeyInfo returned
 * by the browser at registration (no attestation: synced passkeys do not provide one).
 */
export interface MandateSignature {
  scheme: 'webauthn';
  rpId: string;
  origin: string;
  credentialId: string;
  publicKey: string;
  /** COSE algorithm: -8 EdDSA, -7 ES256, -257 RS256. */
  alg: number;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export type BuyerSignature =
  | { status: 'signed'; credentialId: string; alg: number; signedAt: string; userVerified: true }
  | { status: 'unsigned' }
  | { status: 'invalid'; reason: string };

const ALGS: Record<number, string | null> = { [-8]: null, [-7]: 'sha256', [-257]: 'sha256' };
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

const b64 = (s: string) => Buffer.from(s, 'base64url');

/** The WebAuthn challenge for a mandate: the raw bytes of its SHA-256 hash. */
export function mandateChallenge(mandateHash: string): string {
  return Buffer.from(mandateHash, 'hex').toString('base64url');
}

/** What the verifier itself expects, instead of trusting what the receipt says about where it was signed. */
export interface ExpectedSigner { origin?: string; rpId?: string }

/** The key type each declared COSE algorithm requires: the receipt must not be able to call any key "ES256". */
function keyMatches(alg: number, key: KeyObject): boolean {
  const d = key.asymmetricKeyDetails;
  if (alg === -7) return key.asymmetricKeyType === 'ec' && d?.namedCurve === 'prime256v1';
  if (alg === -8) return key.asymmetricKeyType === 'ed25519';
  if (alg === -257) return key.asymmetricKeyType === 'rsa' && (d?.modulusLength ?? 0) >= 2048;
  return false;
}

/** Checks one assertion against the mandate hash it must have signed. */
export function verifyMandateSignature(sig: MandateSignature, mandateHash: string, expected: ExpectedSigner = {}): { valid: true } | { valid: false; reason: string } {
  try {
    if (sig?.scheme !== 'webauthn') return { valid: false, reason: 'unknown signature scheme' };
    if (!(sig.alg in ALGS)) return { valid: false, reason: `unsupported algorithm ${sig.alg}` };
    let client: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
    try { client = JSON.parse(b64(sig.clientDataJSON).toString('utf8')); } catch { return { valid: false, reason: 'unreadable client data' }; }
    if (client.type !== 'webauthn.get') return { valid: false, reason: 'not an authentication assertion' };
    if (client.challenge !== mandateChallenge(mandateHash)) return { valid: false, reason: 'the passkey signed another mandate' };
    if (client.origin !== sig.origin) return { valid: false, reason: 'origin does not match the client data' };
    if (client.crossOrigin === true) return { valid: false, reason: 'signed inside a frame of another site' };
    if (expected.origin && sig.origin !== expected.origin) return { valid: false, reason: `signed on ${sig.origin}, not ${expected.origin}` };
    if (expected.rpId && sig.rpId !== expected.rpId) return { valid: false, reason: `relying party ${sig.rpId}, not ${expected.rpId}` };

    const auth = b64(sig.authenticatorData);
    if (auth.length < 37) return { valid: false, reason: 'authenticator data too short' };
    if (!auth.subarray(0, 32).equals(createHash('sha256').update(sig.rpId).digest())) return { valid: false, reason: 'relying party does not match' };
    const flags = auth.readUInt8(32);
    if (!(flags & FLAG_UP)) return { valid: false, reason: 'user was not present' };
    if (!(flags & FLAG_UV)) return { valid: false, reason: 'user was not verified (no biometric or PIN)' };

    const key = createPublicKey({ key: b64(sig.publicKey), format: 'der', type: 'spki' });
    if (!keyMatches(sig.alg, key)) return { valid: false, reason: `key type does not match algorithm ${sig.alg}` };
    const signed = Buffer.concat([auth, createHash('sha256').update(b64(sig.clientDataJSON)).digest()]);
    const ok = sig.alg === -7
      ? verify('sha256', signed, { key, dsaEncoding: 'der' }, b64(sig.signature))
      : verify(ALGS[sig.alg], signed, key, b64(sig.signature));
    return ok ? { valid: true } : { valid: false, reason: 'passkey signature does not match' };
  } catch {
    return { valid: false, reason: 'malformed signature record' };
  }
}

/** Short fingerprint of a passkey's public key. */
export function keyTag(publicKey: string): string {
  return createHash('sha256').update(b64(publicKey)).digest('hex').slice(0, 32);
}

/**
 * What goes into each order's `custom_id` once a mandate is signed: the mandate hash and the key's
 * fingerprint. PayPal keeps it from the moment of the order, so the key cannot be swapped afterwards,
 * for example once a dispute has been opened.
 */
export function anchorFor(mandateHash: string, publicKey: string): string {
  return `${mandateHash}.${keyTag(publicKey)}`;
}

/** The hash a passkey signs to approve one order: this mandate, this PayPal order, this amount. */
export function approvalHash(input: { mandateHash: string; orderId: string; amount: Money }): string {
  return hashOf({ purpose: 'mandat.order-approval', mandateHash: input.mandateHash, orderId: input.orderId, amount: input.amount });
}

export interface ApprovalSignature { orderId: string; signature: MandateSignature }

/**
 * For one order above the threshold: the mandate's passkey signed this exact order, and PayPal
 * reported who approved it. `signed` means the capture has not happened yet.
 */
export type PayerLink =
  | { orderId: string; status: 'linked'; payerId: string; signedAt: string }
  | { orderId: string; status: 'signed'; signedAt: string }
  | { orderId: string; status: 'invalid'; reason: string };

/** The amount the guard decided for an order: the `decision` entry just before its `order.created`. */
function decidedAmount(entries: LedgerEntry[], orderId: string): Money | undefined {
  const at = entries.findIndex(e => e.type === 'order.created' && (e.data as { orderId?: string }).orderId === orderId);
  for (let i = at - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.type === 'decision') return (e.data as { amount?: Money }).amount;
  }
  return undefined;
}

/** Checks one order approval against the key that signed the mandate. */
export function verifyApproval(entries: LedgerEntry[], mandateHash: string, a: ApprovalSignature, expected: ExpectedSigner = {}): { valid: true } | { valid: false; reason: string } {
  const mandateSig = entries.find(e => e.type === 'mandate.signed')?.data as MandateSignature | undefined;
  if (!mandateSig) return { valid: false, reason: 'the mandate is not signed' };
  if (a?.signature?.publicKey !== mandateSig.publicKey || a.signature.credentialId !== mandateSig.credentialId) {
    return { valid: false, reason: 'signed by another key than the mandate' };
  }
  const amount = decidedAmount(entries, a.orderId);
  if (!amount) return { valid: false, reason: 'unknown order' };
  return verifyMandateSignature(a.signature, approvalHash({ mandateHash, orderId: a.orderId, amount }), expected);
}

/** Every signed order approval in a ledger, with the payer PayPal reported for it. */
export function payerLinks(entries: LedgerEntry[], mandateHash: string, expected: ExpectedSigner = {}): PayerLink[] {
  return entries.filter(e => e.type === 'approval.signed').map(e => {
    const a = e.data as ApprovalSignature;
    const r = verifyApproval(entries, mandateHash, a, expected);
    if (!r.valid) return { orderId: a.orderId, status: 'invalid', reason: r.reason };
    const payerId = entries.filter(x => x.type === 'order.captured').map(x => x.data as { orderId?: string; payerId?: string }).find(d => d.orderId === a.orderId)?.payerId;
    return payerId ? { orderId: a.orderId, status: 'linked', payerId, signedAt: e.at } : { orderId: a.orderId, status: 'signed', signedAt: e.at };
  });
}

/** Whether every order of a signed mandate carries that key's fingerprint in its `custom_id`. */
export function keyAnchored(entries: LedgerEntry[], mandateHash: string): 'anchored' | 'not_anchored' | 'no_orders' | 'unsigned' {
  const sig = entries.find(e => e.type === 'mandate.signed')?.data as MandateSignature | undefined;
  if (!sig) return 'unsigned';
  const orders = entries.filter(e => e.type === 'order.created').map(e => e.data as { customId?: string });
  if (!orders.length) return 'no_orders';
  return orders.every(o => o.customId === anchorFor(mandateHash, sig.publicKey)) ? 'anchored' : 'not_anchored';
}

/**
 * Reads the buyer's signature from a ledger: entry 0 must issue the mandate whose hash is
 * `mandateHash`, and a `mandate.signed` entry, if present, must carry a valid assertion over it.
 */
export function buyerSignature(entries: LedgerEntry[], mandateHash: string, expected: ExpectedSigner = {}): BuyerSignature {
  const signed = entries.find(e => e.type === 'mandate.signed');
  if (!signed) return { status: 'unsigned' };
  const issued = entries[0]?.data as { mandate?: unknown } | undefined;
  if (entries[0]?.type !== 'mandate.issued' || !issued?.mandate || hashOf(issued.mandate) !== mandateHash) {
    return { status: 'invalid', reason: 'the issued mandate does not match the mandate hash' };
  }
  const sig = signed.data as MandateSignature;
  const r = verifyMandateSignature(sig, mandateHash, expected);
  if (!r.valid) return { status: 'invalid', reason: r.reason };
  return { status: 'signed', credentialId: sig.credentialId, alg: sig.alg, signedAt: signed.at, userVerified: true };
}
