import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey, type KeyObject } from 'node:crypto';
import { canonical, sha256Hex } from './canonical.ts';

export const GENESIS = '0'.repeat(64);

export interface LedgerEntry {
  seq: number;
  type: string;
  at: string;
  data: unknown;
  prev: string;
  hash: string;
}

export interface SealedReceipt {
  mandateHash: string;
  entries: LedgerEntry[];
  head: string;
  keyId: string;
  signature: string;
}

function entryHash(e: Omit<LedgerEntry, 'hash'>): string {
  return sha256Hex(canonical({ seq: e.seq, type: e.type, at: e.at, data: e.data, prev: e.prev }));
}

/** Append-only, hash-chained event log for one mandate. */
export class Ledger {
  readonly entries: LedgerEntry[] = [];
  readonly mandateHash: string;

  constructor(mandateHash: string, entries: LedgerEntry[] = []) {
    this.mandateHash = mandateHash;
    this.entries.push(...entries);
  }

  get head(): string {
    return this.entries.at(-1)?.hash ?? GENESIS;
  }

  append(type: string, data: unknown, at: Date = new Date()): LedgerEntry {
    const base = { seq: this.entries.length, type, at: at.toISOString(), data, prev: this.head };
    const entry = { ...base, hash: entryHash(base) };
    this.entries.push(entry);
    return entry;
  }

  seal(key: SigningKey): SealedReceipt {
    const payload = canonical({ mandateHash: this.mandateHash, head: this.head });
    const signature = sign(null, Buffer.from(payload), key.privateKey).toString('base64url');
    return { mandateHash: this.mandateHash, entries: structuredClone(this.entries), head: this.head, keyId: key.keyId, signature };
  }
}

export interface SigningKey {
  keyId: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function generateSigningKey(keyId: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { keyId, privateKey, publicKey };
}

/** Load an Ed25519 key from a PKCS#8 PEM (e.g. an environment variable). */
export function loadSigningKey(keyId: string, pkcs8Pem: string): SigningKey {
  const privateKey = createPrivateKey(pkcs8Pem);
  return { keyId, privateKey, publicKey: createPublicKey(privateKey) };
}

export type VerifyResult = { valid: true } | { valid: false; reason: string };

/** Recompute every link of the chain, then check the signature over (mandateHash, head). */
export function verifyReceipt(r: SealedReceipt, publicKey: KeyObject): VerifyResult {
  let prev = GENESIS;
  for (const [i, e] of r.entries.entries()) {
    if (e.seq !== i) return { valid: false, reason: `entry ${i}: wrong sequence number` };
    if (e.prev !== prev) return { valid: false, reason: `entry ${i}: broken chain` };
    if (entryHash(e) !== e.hash) return { valid: false, reason: `entry ${i}: content was modified` };
    prev = e.hash;
  }
  if (prev !== r.head) return { valid: false, reason: 'head does not match the last entry' };
  const payload = canonical({ mandateHash: r.mandateHash, head: r.head });
  const ok = verify(null, Buffer.from(payload), publicKey, Buffer.from(r.signature, 'base64url'));
  return ok ? { valid: true } : { valid: false, reason: 'signature does not match' };
}
