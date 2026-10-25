import 'server-only';
import { randomBytes } from 'node:crypto';
import { Guard, PayPalRail, type LedgerEntry, type Mandate, type MandateSignature } from '@mandat/guard';
import { db } from './db';
import { PUBLIC_URL, paypalCredentials } from './env';

export interface SessionRow { id: string; created_at: string; mandate: string; ledger: string }

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;

export function railFor(sessionId: string): PayPalRail {
  const back = `${PUBLIC_URL}/api/paypal/return?s=${encodeURIComponent(sessionId)}`;
  return new PayPalRail({ ...paypalCredentials(), returnUrl: back, cancelUrl: `${back}&cancel=1` });
}

const guards = new Map<string, Guard>();

/** A verified buyer signature, when given, is the ledger's second entry, right after the mandate it signs. */
export function createSession(mandate: Mandate, signature?: MandateSignature): string {
  const id = newId('s');
  const guard = new Guard(mandate, railFor(id));
  if (signature) guard.record('mandate.signed', signature);
  db().prepare('INSERT INTO sessions (id, created_at, mandate, ledger) VALUES (?, ?, ?, ?)')
    .run(id, new Date().toISOString(), JSON.stringify(mandate), JSON.stringify(guard.ledger.entries));
  guards.set(id, guard);
  return id;
}

export function getSession(id: string): SessionRow | undefined {
  return db().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

/** One live guard per session; rebuilt from the stored ledger after a restart. */
export function guardFor(id: string): Guard | undefined {
  const cached = guards.get(id);
  if (cached) return cached;
  const row = getSession(id);
  if (!row) return undefined;
  const guard = Guard.restore(JSON.parse(row.mandate) as Mandate, railFor(id), JSON.parse(row.ledger) as LedgerEntry[]);
  guards.set(id, guard);
  return guard;
}

export function saveLedger(id: string, guard: Guard): void {
  db().prepare('UPDATE sessions SET ledger = ? WHERE id = ?').run(JSON.stringify(guard.ledger.entries), id);
}

export interface AgentEvent { seq: number; runId: string; at: string; kind: string; data: unknown }

export function logAgent(sessionId: string, runId: string, kind: string, data: unknown): void {
  const next = (db().prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM agent_events WHERE session_id = ?').get(sessionId) as { n: number }).n;
  db().prepare('INSERT INTO agent_events (session_id, seq, run_id, at, kind, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, next, runId, new Date().toISOString(), kind, JSON.stringify(data));
}

export function agentEvents(sessionId: string): AgentEvent[] {
  return (db().prepare('SELECT seq, run_id, at, kind, data FROM agent_events WHERE session_id = ? ORDER BY seq').all(sessionId) as any[])
    .map(r => ({ seq: r.seq, runId: r.run_id, at: r.at, kind: r.kind, data: JSON.parse(r.data) }));
}
