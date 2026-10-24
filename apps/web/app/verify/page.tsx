import { Suspense } from 'react';
import { VerifyForm } from '@/components/verify';
import { DEMO_SESSION_ID } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function VerifyPage() {
  return (
    <div className="stack-lg" style={{ maxWidth: '72ch' }}>
      <section className="stack">
        <h1>Verify a receipt</h1>
        <p className="lede">Anyone can check a Mandat receipt: paste it, or load it from a run (it is also attached to every evidence PDF). The chain of hashes is recomputed and the Ed25519 signature is checked against the public key published at <a href="/.well-known/mandat-keys.json">/.well-known/mandat-keys.json</a>.</p>
      </section>
      <Suspense><VerifyForm demoSession={DEMO_SESSION_ID} /></Suspense>
    </div>
  );
}
