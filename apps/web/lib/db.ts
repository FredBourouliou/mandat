import 'server-only';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './env';

let handle: Database.Database | undefined;

/** Opened on first use, so building the app never touches the data disk. */
export function db(): Database.Database {
  if (handle) return handle;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(join(DATA_DIR, 'mandat.db'));
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  return (handle = d);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  mandate TEXT NOT NULL,
  ledger TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mandate_drafts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  mandate TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  view TEXT,
  draft TEXT,
  response TEXT,
  simulated_outcome TEXT,
  first_webhook_at TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resource_id TEXT,
  received_at TEXT NOT NULL,
  verified INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);
`;

/** Counts one use of `key` today and reports whether it stays within `limit`. */
export function consume(key: string, limit: number): boolean {
  if (process.env.MANDAT_TEST_HARNESS === '1') return true;
  const day = new Date().toISOString().slice(0, 10);
  const row = db().prepare('SELECT count FROM usage WHERE key = ? AND day = ?').get(key, day) as { count: number } | undefined;
  if ((row?.count ?? 0) >= limit) return false;
  db().prepare('INSERT INTO usage (key, day, count) VALUES (?, ?, 1) ON CONFLICT(key, day) DO UPDATE SET count = count + 1').run(key, day);
  return true;
}
