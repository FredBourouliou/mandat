import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

/** RFC 8785 (JCS) canonical JSON: the same value always yields the same bytes. */
export function canonical(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error('value cannot be canonicalized');
  return out;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonical(value));
}
