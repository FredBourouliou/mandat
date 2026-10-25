import 'server-only';
import { z } from 'zod';
import { mandateHash, verifyMandateSignature, type Mandate, type MandateSignature } from '@mandat/guard';
import { DEMO_MERCHANT } from './catalog';
import { db } from './db';
import { SIGNER } from './env';
import { newId } from './store';

export const MandateBody = z.object({
  purpose: z.string().trim().min(3).max(120),
  maxTotal: z.number().int().min(1000).max(20000),
  maxPerPurchase: z.number().int().min(1000).max(20000),
  approvalAbove: z.number().int().min(0).max(20000),
  maxPurchases: z.number().int().min(1).max(10),
  days: z.number().int().min(1).max(30),
});

/** A demo mandate from the form. Amounts are in euro cents, capped at 200 EUR (sandbox). */
export function buildMandate(b: z.infer<typeof MandateBody>): Mandate {
  const eur = (minor: number) => ({ currency: 'EUR', minor });
  const now = new Date();
  return {
    id: newId('mdt'),
    principal: 'demo-buyer',
    purpose: b.purpose,
    merchants: [DEMO_MERCHANT.id],
    categories: ['outdoor', 'travel'],
    maxTotal: eur(b.maxTotal),
    maxPerPurchase: eur(Math.min(b.maxPerPurchase, b.maxTotal)),
    approvalAbove: eur(b.approvalAbove),
    maxPurchases: b.maxPurchases,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + b.days * 864e5).toISOString(),
  };
}

/** The relying party is this deployment: passkeys are bound to its host name. */
export const RP_ID = SIGNER.rpId;
const DRAFT_TTL_MS = 10 * 60_000;

/** Stores a mandate waiting for the buyer's passkey. Its id and dates are fixed now, so the hash the passkey signs is final. */
export function saveDraft(mandate: Mandate): void {
  db().prepare('DELETE FROM mandate_drafts WHERE created_at < ?').run(new Date(Date.now() - DRAFT_TTL_MS).toISOString());
  db().prepare('INSERT INTO mandate_drafts (id, created_at, mandate) VALUES (?, ?, ?)').run(mandate.id, new Date().toISOString(), JSON.stringify(mandate));
}

/** Takes a draft once: a signed draft becomes a session and cannot be reused. */
export function takeDraft(id: string): Mandate | null {
  const row = db().prepare('DELETE FROM mandate_drafts WHERE id = ? AND created_at >= ? RETURNING mandate')
    .get(id, new Date(Date.now() - DRAFT_TTL_MS).toISOString()) as { mandate: string } | undefined;
  return row ? (JSON.parse(row.mandate) as Mandate) : null;
}

export const SignatureBody = z.object({
  mandateId: z.string().regex(/^mdt_[A-Za-z0-9_-]{16}$/),
  credentialId: z.string().max(1400),
  publicKey: z.string().max(1400),
  alg: z.number().int(),
  authenticatorData: z.string().max(4000),
  clientDataJSON: z.string().max(4000),
  signature: z.string().max(1400),
});

/** Completes the assertion with this deployment's origin and relying party, then checks it against the draft's hash. */
export function checkSignature(mandate: Mandate, b: z.infer<typeof SignatureBody>): MandateSignature | string {
  const { mandateId: _, ...rest } = b;
  const sig: MandateSignature = { scheme: 'webauthn', rpId: SIGNER.rpId, origin: SIGNER.origin, ...rest };
  const r = verifyMandateSignature(sig, mandateHash(mandate), SIGNER);
  return r.valid ? sig : r.reason;
}
