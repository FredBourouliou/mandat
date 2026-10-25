import { createHash, createPublicKey, verify } from 'node:crypto';
import { hashOf } from './canonical.ts';
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

/** Checks one assertion against the mandate hash it must have signed. */
export function verifyMandateSignature(sig: MandateSignature, mandateHash: string, expectedOrigin?: string): { valid: true } | { valid: false; reason: string } {
  if (sig?.scheme !== 'webauthn') return { valid: false, reason: 'unknown signature scheme' };
  if (!(sig.alg in ALGS)) return { valid: false, reason: `unsupported algorithm ${sig.alg}` };
  let client: { type?: string; challenge?: string; origin?: string };
  try { client = JSON.parse(b64(sig.clientDataJSON).toString('utf8')); } catch { return { valid: false, reason: 'unreadable client data' }; }
  if (client.type !== 'webauthn.get') return { valid: false, reason: 'not an authentication assertion' };
  if (client.challenge !== mandateChallenge(mandateHash)) return { valid: false, reason: 'the passkey signed another mandate' };
  if (client.origin !== sig.origin) return { valid: false, reason: 'origin does not match the client data' };
  if (expectedOrigin && sig.origin !== expectedOrigin) return { valid: false, reason: `signed on ${sig.origin}, not ${expectedOrigin}` };

  const auth = b64(sig.authenticatorData);
  if (auth.length < 37) return { valid: false, reason: 'authenticator data too short' };
  if (!auth.subarray(0, 32).equals(createHash('sha256').update(sig.rpId).digest())) return { valid: false, reason: 'relying party does not match' };
  const flags = auth.readUInt8(32);
  if (!(flags & FLAG_UP)) return { valid: false, reason: 'user was not present' };
  if (!(flags & FLAG_UV)) return { valid: false, reason: 'user was not verified (no biometric or PIN)' };

  try {
    const key = createPublicKey({ key: b64(sig.publicKey), format: 'der', type: 'spki' });
    const signed = Buffer.concat([auth, createHash('sha256').update(b64(sig.clientDataJSON)).digest()]);
    const ok = sig.alg === -7
      ? verify('sha256', signed, { key, dsaEncoding: 'der' }, b64(sig.signature))
      : verify(ALGS[sig.alg], signed, key, b64(sig.signature));
    return ok ? { valid: true } : { valid: false, reason: 'passkey signature does not match' };
  } catch {
    return { valid: false, reason: 'malformed public key or signature' };
  }
}

/**
 * Reads the buyer's signature from a ledger: entry 0 must issue the mandate whose hash is
 * `mandateHash`, and a `mandate.signed` entry, if present, must carry a valid assertion over it.
 */
export function buyerSignature(entries: LedgerEntry[], mandateHash: string, expectedOrigin?: string): BuyerSignature {
  const signed = entries.find(e => e.type === 'mandate.signed');
  if (!signed) return { status: 'unsigned' };
  const issued = entries[0]?.data as { mandate?: unknown } | undefined;
  if (entries[0]?.type !== 'mandate.issued' || !issued?.mandate || hashOf(issued.mandate) !== mandateHash) {
    return { status: 'invalid', reason: 'the issued mandate does not match the mandate hash' };
  }
  const sig = signed.data as MandateSignature;
  const r = verifyMandateSignature(sig, mandateHash, expectedOrigin);
  if (!r.valid) return { status: 'invalid', reason: r.reason };
  return { status: 'signed', credentialId: sig.credentialId, alg: sig.alg, signedAt: signed.at, userVerified: true };
}
