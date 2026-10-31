// Mutation check: disables one guard rule at a time and asserts that the test suite then fails.
// Sources are patched in place and always restored. Usage: pnpm --filter @mandat/guard mutation
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MANDATE = 'src/mandate.ts', EXECUTE = 'src/execute.ts';
const mutants: [name: string, file: string, from: string, to: string][] = [
  ['per-purchase limit', MANDATE, 'if (amount.minor > m.maxPerPurchase.minor) {', 'if (false) {'],
  ['total limit', MANDATE, 'if (spent.total.minor + amount.minor > m.maxTotal.minor) {', 'if (false) {'],
  ['number of purchases', MANDATE, 'if (spent.count >= m.maxPurchases)', 'if (false)'],
  ['currency', MANDATE, 'if (amount.currency !== m.maxPerPurchase.currency)', 'if (false)'],
  ['merchant', MANDATE, 'if (!m.merchants.includes(p.merchant))', 'if (false)'],
  ['category', MANDATE, 'if (!m.categories.includes(p.category))', 'if (false)'],
  ['not yet valid', MANDATE, 'if (t < Date.parse(m.validFrom))', 'if (false)'],
  ['expired', MANDATE, 'if (t > Date.parse(m.validUntil))', 'if (false)'],
  ['quantity', MANDATE, 'if (!Number.isInteger(p.quantity) || p.quantity < 1)', 'if (false)'],
  ['price', MANDATE, 'if (!Number.isInteger(p.unitPrice.minor) || p.unitPrice.minor <= 0)', 'if (false)'],
  ['approval threshold', MANDATE, 'if (amount.minor > m.approvalAbove.minor) {', 'if (false) {'],
  ['serialization', EXECUTE, 'const run = this.queue.then(fn, fn);', 'const run = fn();'],
  ['idempotency', EXECUTE, 'const existing = this.purchases.get(proposal.id);', 'const existing = undefined as any;'],
];

let survivors = 0;
for (const [name, file, from, to] of mutants) {
  const path = root + file;
  const original = readFileSync(path, 'utf8');
  if (!original.includes(from)) throw new Error(`mutant "${name}": pattern not found in ${file}`);
  try {
    writeFileSync(path, original.replace(from, to));
    let killed = false;
    try {
      execFileSync('pnpm', ['exec', 'vitest', 'run'], { cwd: root, stdio: 'pipe' });
    } catch { killed = true; }
    if (!killed) survivors++;
    console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${name}`);
  } finally {
    writeFileSync(path, original);
  }
}
console.log(`${mutants.length - survivors}/${mutants.length} mutants killed`);
process.exit(survivors ? 1 : 0);
