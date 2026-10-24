import { VerifyForm } from '@/components/verify';

export default function VerifyPage() {
  return (
    <div className="stack-lg" style={{ maxWidth: '72ch' }}>
      <section className="stack">
        <p className="eyebrow">Anyone can check</p>
        <h1>Verify a receipt</h1>
        <p className="lede">Paste a Mandat receipt (the JSON attached to every evidence PDF). The chain of hashes is recomputed and the Ed25519 signature is checked against the public key published at <a href="/.well-known/mandat-keys.json">/.well-known/mandat-keys.json</a>.</p>
      </section>
      <VerifyForm />
    </div>
  );
}
