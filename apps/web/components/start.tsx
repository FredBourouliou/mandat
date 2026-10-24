'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

export function AccessForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="deed" aria-labelledby="live-title">
      <h2 id="live-title">Run it live</h2>
      <p className="muted">For the judges: a new purchase with Claude and the PayPal sandbox. Needs the access code given with the submission. Anyone can also run the project locally from the README.</p>
      <form className="btn-row" onSubmit={async e => {
        e.preventDefault(); setError('');
        if (!code.trim()) { setError('Enter the access code.'); return; }
        try { await post('/api/access', { code }); router.refresh(); } catch (err) { setError((err as Error).message); }
      }}>
        <label style={{ flex: '1 1 220px' }}>Access code<input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>
        <button className="btn" style={{ alignSelf: 'end' }}>Unlock</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function MandateForm() {
  const router = useRouter();
  // Number fields keep the raw text, so a field can be emptied and retyped without snapping to 0.
  const [f, setF] = useState({ purpose: 'Gear for a three-day hike in the Jura', maxTotal: '200', maxPerPurchase: '130', approvalAbove: '80', maxPurchases: '4', days: '7' });
  const n = (k: Exclude<keyof typeof f, 'purpose'>) => Number(f[k] || 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const invalid = ([['maxTotal', 10, 200], ['maxPerPurchase', 10, 200], ['approvalAbove', 0, 200], ['maxPurchases', 1, 10], ['days', 1, 30]] as const)
    .some(([k, lo, hi]) => f[k] === '' || n(k) < lo || n(k) > hi || !Number.isInteger(n(k)));
  return (
    <form className="deed narrow" onSubmit={async e => {
      e.preventDefault(); setError('');
      if (invalid) { setError('Amounts go from 10 to 200 EUR (threshold from 0), 1 to 10 purchases, 1 to 30 days, whole numbers.'); return; }
      setBusy(true);
      try {
        const { id } = await post('/api/sessions', {
          purpose: f.purpose, maxTotal: n('maxTotal') * 100, maxPerPurchase: n('maxPerPurchase') * 100,
          approvalAbove: n('approvalAbove') * 100, maxPurchases: n('maxPurchases'), days: n('days'),
        });
        router.push(`/s/${id}`);
      } catch (err) { setError((err as Error).message); setBusy(false); }
    }}>
      <div className="section-head"><h2>Sign a mandate</h2><span className="faint">Merchant: Atelier Voyage · outdoor and travel</span></div>
      <label>Purpose<input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} maxLength={120} required /></label>
      <div className="field-grid">
        <label>Total budget (EUR)<input type="number" min={10} max={200} value={f.maxTotal} onChange={num('maxTotal')} /></label>
        <label>Per purchase (EUR)<input type="number" min={10} max={200} value={f.maxPerPurchase} onChange={num('maxPerPurchase')} /></label>
        <label>Ask me above (EUR)<input type="number" min={0} max={200} value={f.approvalAbove} onChange={num('approvalAbove')} /></label>
        <label>Purchases<input type="number" min={1} max={10} value={f.maxPurchases} onChange={num('maxPurchases')} /></label>
        <label>Valid for (days)<input type="number" min={1} max={30} value={f.days} onChange={num('days')} /></label>
      </div>
      <p className="notice" aria-live="polite">
        <strong>What you are signing:</strong> the agent can spend at most {n('maxTotal')} EUR in total, on outdoor and travel items from Atelier Voyage, {Math.min(n('maxPerPurchase'), n('maxTotal'))} EUR per purchase,
        in {n('maxPurchases')} purchase{n('maxPurchases') === 1 ? '' : 's'} or fewer, for {n('days')} day{n('days') === 1 ? '' : 's'}.
        {n('approvalAbove') > 0 ? ` Above ${n('approvalAbove')} EUR, PayPal asks for your approval first.` : ' Every purchase goes to PayPal for your approval.'} Nothing else can be bought.
      </p>
      <div className="btn-row">
        <button className="btn btn-seal" disabled={busy}>{busy ? 'Sealing…' : 'Sign and hand to the agent'}</button>
        <span className="faint">Sandbox only. Capped at 200 EUR.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
