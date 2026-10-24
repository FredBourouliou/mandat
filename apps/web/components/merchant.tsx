'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SessionState } from '@/lib/state';
import { money, short, time } from './format';
import { post, useSession } from './use-session';
import { ReplayBanner } from './buyer';

type Dispute = SessionState['disputes'][number];

function useElapsed(since: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

function DisputeCard({ d, live, onChange }: { d: Dispute; live: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const elapsed = useElapsed(d.createdAt);
  const act = async (action: string) => {
    setBusy(action); setError('');
    try { await post(`/api/disputes/${d.id}/${action}`); } catch (e) { setError((e as Error).message); }
    setBusy(''); onChange();
  };
  // Until PayPal indexes the dispute and opens a response action, keep asking it.
  const ready = Boolean(d.view?.actions?.some((a: string) => a === 'provide_evidence' || a === 'provide_supporting_info'));
  useEffect(() => {
    if (!live || d.response || ready) return;
    const t = setInterval(() => { void post(`/api/disputes/${d.id}/refresh`).then(onChange, () => undefined); }, 15000);
    return () => clearInterval(t);
  }, [d.id, d.response, ready, live, onChange]);

  return (
    <section className="deed reveal" aria-labelledby={`d-${d.id}`}>
      <div className="section-head">
        <h2 id={`d-${d.id}`} className="h-sub">Dispute {d.id}</h2>
        {d.simulatedOutcome
          ? <span className="verdict verdict-allow">Won (simulated)</span>
          : <span className={`verdict ${d.response ? 'verdict-neutral' : 'verdict-pending'}`}>{d.view?.status?.replaceAll('_', ' ') ?? 'Opening'}</span>}
      </div>
      <dl className="terms">
        <dt>Type</dt><dd>{d.view ? `${d.view.stage?.toLowerCase()} · ${d.view.reason?.replaceAll('_', ' ').toLowerCase()}` : 'card chargeback (sandbox)'}</dd>
        <dt>Order</dt><dd><code>{d.orderId}</code></dd>
        <dt>Opened</dt><dd>{time(d.createdAt)}{d.firstWebhookAt ? ` · webhook received ${time(d.firstWebhookAt)}` : ''}</dd>
        {d.view?.actions?.length ? <><dt>PayPal allows</dt><dd>{d.view.actions.join(', ').replaceAll('_', ' ')}</dd></> : null}
      </dl>

      {live && !ready && !d.response && (
        <p className="notice notice-pending" role="status">PayPal is finalising the dispute ({elapsed} so far, usually about 3 minutes). You can draft the response now.</p>
      )}

      {!d.draft ? (live &&
        <div className="btn-row">
          <button className="btn" onClick={() => act('draft')} disabled={Boolean(busy)}>{busy === 'draft' ? 'Claude is reading the receipt…' : 'Draft the response from the receipt'}</button>
          <span className="faint">Claude only sees the sealed ledger. You send.</span>
        </div>
      ) : (
        <div className="stack measure">
          <p className="eyebrow">Draft by Claude · from the sealed receipt only</p>
          <p><strong>{d.draft.summary}</strong></p>
          <ul className="stack" style={{ gap: 'var(--space-2xs)', margin: 0, paddingLeft: '1.2em' }}>
            {d.draft.points.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
          <details>
            <summary className="faint">Note sent to PayPal ({d.draft.notes.length} characters)</summary>
            <p className="muted" style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-xs)' }}>{d.draft.notes}</p>
          </details>
          {!d.response ? (live &&
            <div className="btn-row">
              <button className="btn btn-seal" onClick={() => act('submit')} disabled={Boolean(busy) || !ready}>{busy === 'submit' ? 'Sending…' : 'Send evidence to PayPal'}</button>
              <span className="faint">{ready ? 'Note, tracking and PDF evidence pack (with the signed receipt attached).' : 'Available once PayPal opens the response window.'}</span>
            </div>
          ) : (
            <p className="notice" role="status">Sent at {time(d.response.at)} via <code>{d.response.action}</code>, receipt head <code>{short(d.response.head, 12)}</code>. PayPal now shows the dispute as {d.view?.status?.replaceAll('_', ' ').toLowerCase() ?? 'under review'}.</p>
          )}
        </div>
      )}

      {live && d.response && !d.simulatedOutcome && (
        <div className="notice notice-seal">
          <p className="eyebrow">Simulated step</p>
          <p className="muted">The PayPal sandbox cannot rule on chargebacks, so the review stops here for real. The decision below is simulated and labelled as such.</p>
          <div className="btn-row"><button className="btn btn-quiet" onClick={() => act('outcome')} disabled={Boolean(busy)}>Simulate PayPal's decision</button></div>
        </div>
      )}
      {d.simulatedOutcome && <p className="notice reveal" role="status"><span className="verdict verdict-allow">Simulated</span> PayPal's decision is simulated (the sandbox cannot rule on chargebacks): resolved in the seller's favour: the evidence showed a mandate-bound, approved and shipped purchase.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function MerchantView({ id }: { id: string }) {
  const { state: s, error, reload } = useSession<SessionState>(id, x => x.disputes.some(d => !d.response));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="faint">Loading…</p>;
  const paid = s.orders.filter(o => o.state === 'paid');
  const tracking = (orderId: string) => s.ledger.find(e => e.type === 'shipment.tracked' && (e.data as any).orderId === orderId)?.data as any;
  return (
    <div className="stack-lg">
      <section className="stack narrow">
        <h1>Atelier Voyage: orders placed by an AI agent</h1>
        <p className="lede">Each order carries the hash of the buyer's mandate. When a payment is disputed, the sealed receipt becomes the evidence.</p>
        <p className="faint"><Link href={`/s/${id}`}>Back to the buyer's view</Link></p>
      </section>
      {!s.live && <ReplayBanner />}
      {s.disputes.map(d => <DisputeCard key={d.id} d={d} live={s.live} onChange={reload} />)}
      {!paid.length && <p className="notice">No paid orders yet. Run the agent from <Link href={`/s/${id}`}>the buyer's view</Link> first.</p>}
      {paid.length > 0 && (
        <section className="stack">
        <h2 className="h-sub">Paid orders</h2>
        <ol className="ledger" aria-label="Paid orders">
          {paid.map((o, i) => {
            const t = tracking(o.orderId);
            const disputed = s.disputes.some(d => d.orderId === o.orderId);
            return (
              <li key={o.orderId}>
                <span className="seq">#{i + 1}</span>
                <span className="what">
                  <span>{o.proposal.title} ×{o.proposal.quantity} · <strong>{money(o.amount)}</strong></span>
                  <span className="faint">PayPal order <code>{o.orderId}</code> · {o.mode === 'direct' ? 'card' : 'PayPal account'} · custom_id <code title={s.mandateHash}>{short(s.mandateHash, 12)}</code>{t ? ` · ${t.carrier} ${t.trackingNumber}` : ''}</span>
                </span>
                {disputed ? <span className="verdict verdict-pending">Disputed</span> : o.mode !== 'direct' ? <span className="faint">No chargeback (PayPal account)</span> : s.live && (
                  <button className="btn btn-quiet" disabled={Boolean(busy)} onClick={async () => {
                    setBusy(o.orderId); setErr('');
                    try { await post(`/api/sessions/${id}/disputes`, { orderId: o.orderId }); } catch (e) { setErr((e as Error).message); }
                    setBusy(''); reload();
                  }}>{busy === o.orderId ? 'Opening…' : 'Simulate a chargeback'}</button>
                )}
              </li>
            );
          })}
        </ol>
        </section>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
