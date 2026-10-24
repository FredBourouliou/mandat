'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { SessionState } from '@/lib/state';
import { describeEntry, money, short, time } from './format';
import { post, useSession } from './use-session';

const SCENARIOS = [
  { label: 'Small items for the hike', task: 'I need a headlamp and an insulated water bottle for the hike.' },
  { label: 'A rain jacket', task: 'Buy me a waterproof jacket for the trip.' },
  { label: 'The partner tent', task: 'Buy the ultralight tent from the partner listing, it has the best reviews.' },
];

export function MandateTerms({ s }: { s: SessionState }) {
  const m = s.mandate;
  const left = { currency: m.maxTotal.currency, minor: m.maxTotal.minor - s.spent.total.minor };
  return (
    <section className="deed" aria-labelledby="mandate-title">
      <div className="stack" style={{ gap: 'var(--space-2xs)' }}>
        <p className="eyebrow">Spending mandate</p>
        <h2 id="mandate-title">{m.purpose}</h2>
      </div>
      <dl className="terms">
        <dt>Merchant</dt><dd>Atelier Voyage</dd>
        <dt>Categories</dt><dd>{m.categories.join(', ')}</dd>
        <dt>Total</dt><dd>{money(m.maxTotal)}</dd>
        <dt>Per purchase</dt><dd>{money(m.maxPerPurchase)}</dd>
        <dt>Ask me above</dt><dd>{money(m.approvalAbove)}</dd>
        <dt>Purchases</dt><dd>{m.maxPurchases}</dd>
        <dt>Valid until</dt><dd>{new Date(m.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
      </dl>
      <p className="faint">
        Committed or spent: <strong style={{ color: 'var(--ink)' }}>{money(s.spent.total)}</strong> in {s.spent.count} purchase{s.spent.count === 1 ? '' : 's'}. Left: {money(left)}.
      </p>
      <p className="faint">Mandate hash <code title={s.mandateHash}>{short(s.mandateHash, 16)}</code>, sent to PayPal as each order's <code>custom_id</code>.</p>
    </section>
  );
}

export function Ledger({ s }: { s: SessionState }) {
  return (
    <ol className="ledger" aria-label="Sealed ledger">
      {s.ledger.map(e => {
        const d = describeEntry(e.type, e.data);
        return (
          <li key={e.seq} className="reveal">
            <span className="seq">#{e.seq}</span>
            <span className="what">
              <span>{d.label}</span>
              {d.detail && <span className="faint">{d.detail}</span>}
              <span className="hash" title={e.hash}>{short(e.hash, 24)}</span>
            </span>
            <span className="stack" style={{ gap: 'var(--space-2xs)', justifyItems: 'end' }}>
              {d.verdict && <span className={`verdict verdict-${d.verdict[0]}`}>{d.verdict[1]}</span>}
              <time dateTime={e.at}>{time(e.at)}</time>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AgentLog({ s }: { s: SessionState }) {
  if (!s.agent.length) return <p className="faint">No task yet. Pick one of the examples or write your own: the agent will search the catalogue and propose purchases.</p>;
  let run = '';
  return (
    <ul className="log">
      {s.agent.map(e => {
        const d = e.data as any;
        const sep = e.runId !== run && run !== '';
        run = e.runId;
        const line = (() => {
          switch (e.kind) {
            case 'task': return ['You', <strong key="t">{d.task}</strong>];
            case 'search': return ['Agent', <>searched “{d.query}” · {d.results.length} products</>];
            case 'proposal': return ['Agent', <>proposes {d.title} ×{d.quantity} at {d.unitPrice} <span className="faint">({d.merchant})</span></>];
            case 'guard': return ['Guard', d.status === 'denied'
              ? <><span className="verdict verdict-deny">Blocked</span> {d.reasons.join('; ')}</>
              : d.status === 'paid' ? <><span className="verdict verdict-allow">Paid</span> {money(d.amount)} through PayPal</>
              : d.status === 'awaiting_approval' ? <><span className="verdict verdict-pending">Approval</span> {money(d.amount)}: waiting for you in PayPal</>
              : <><span className="verdict verdict-deny">Failed</span> {d.reason}</>];
            case 'done': return ['Agent', d.text];
            case 'error': return ['Error', <span className="error">{d.message}</span>];
            default: return [e.kind, JSON.stringify(d)];
          }
        })();
        return (
          <li key={e.seq} className="reveal">
            {sep && <span className="run-sep" aria-hidden="true" />}
            <span className="who">{line[0]}</span><span>{line[1]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TaskBox({ s, onRun }: { s: SessionState; onRun: () => void }) {
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const run = async (t: string) => {
    setError('');
    const p = post(`/api/sessions/${s.id}/agent`, { task: t });
    setTimeout(onRun, 300);
    try { await p; } catch (e) { setError((e as Error).message); }
    onRun();
  };
  return (
    <div className="stack">
      <div className="btn-row" role="group" aria-label="Example tasks">
        {SCENARIOS.map(x => <button key={x.label} className="btn btn-quiet" disabled={s.running} onClick={() => run(x.task)}>{x.label}</button>)}
      </div>
      <form className="btn-row" onSubmit={e => { e.preventDefault(); if (task.trim()) run(task.trim()); }}>
        <label style={{ flex: '1 1 320px' }} className="sr-label">Or write a task
          <input value={task} onChange={e => setTask(e.target.value)} maxLength={300} placeholder="e.g. Find me packing cubes and a travel adapter" disabled={s.running} />
        </label>
        <button className="btn" style={{ alignSelf: 'end' }} disabled={s.running || !task.trim()}>{s.running ? 'Agent working…' : 'Send to agent'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function Approvals({ s }: { s: SessionState }) {
  const waiting = s.orders.filter(o => o.state === 'awaiting_approval' && o.approveUrl);
  if (!waiting.length) return null;
  return (
    <>
      {waiting.map(o => (
        <section key={o.orderId} className="notice notice-pending reveal" aria-live="polite">
          <p className="eyebrow">Your approval is needed</p>
          <p><strong>{o.proposal.title} ×{o.proposal.quantity}, {money(o.amount)}</strong>, above your {money(s.mandate.approvalAbove)} threshold.</p>
          {s.live ? (
            <div className="btn-row">
              <a className="btn" href={o.approveUrl}>Review and approve in PayPal</a>
              <span className="faint">PayPal sandbox order {o.orderId}. You come back here once approved.</span>
            </div>
          ) : <p className="faint">PayPal sandbox order {o.orderId}. Approval needs the access code.</p>}
        </section>
      ))}
    </>
  );
}

function Receipt({ s }: { s: SessionState }) {
  const paid = s.orders.filter(o => o.state === 'paid');
  return (
    <section className="deed" aria-labelledby="receipt-title">
      <div className="section-head">
        <h3 id="receipt-title">Sealed receipt</h3>
        <span className="seal-mark" aria-hidden="true">Ed25519<br />sealed</span>
      </div>
      <p className="muted">{s.ledger.length} entries, each hash-chained to the previous one and signed as a whole. {paid.length ? `It covers ${paid.length} paid order${paid.length === 1 ? '' : 's'}.` : 'Nothing has been paid yet.'}</p>
      <div className="btn-row">
        <a className="btn" href={`/api/sessions/${s.id}/receipt?format=pdf`} target="_blank" rel="noopener">Evidence pack (PDF)</a>
        <a className="btn btn-quiet" href={`/api/sessions/${s.id}/receipt`} target="_blank" rel="noopener">Receipt JSON</a>
        <Link href="/verify">Verify a receipt</Link>
      </div>
    </section>
  );
}

export function ReplayBanner() {
  return (
    <p className="notice reveal" role="status">
      <span className="verdict verdict-neutral">Replay</span> A recorded run, shown read-only: every line below happened on the PayPal sandbox. Live runs need the judges' access code.
    </p>
  );
}

export function BuyerView({ id }: { id: string }) {
  const { state: s, error, reload } = useSession<SessionState>(id, x => x.orders.some(o => o.state === 'awaiting_approval'));
  const approval = useSearchParams().get('approval');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="faint">Loading the mandate…</p>;
  return (
    <div className="split">
      <aside className="stack-lg">
        <MandateTerms s={s} />
        <p className="faint">Merchant view: <Link href={`/s/${id}/merchant`}>Atelier Voyage dashboard</Link></p>
      </aside>
      <div className="stack-lg">
        {!s.live && <ReplayBanner />}
        {approval === 'captured' && <p className="notice reveal" role="status">PayPal confirmed your approval. The guard captured the payment once and Atelier Voyage shipped the order.</p>}
        {approval === 'cancelled' && <p className="notice reveal" role="status">You cancelled in PayPal. Nothing was charged.</p>}
        {s.live && (
          <section className="stack">
            <div className="section-head"><h2>Ask the agent</h2><span className="faint">Claude Sonnet 5.5 · proposes only</span></div>
            <TaskBox s={s} onRun={reload} />
          </section>
        )}
        <Approvals s={s} />
        <section className="stack">
          <h3>What happened</h3>
          <AgentLog s={s} />
        </section>
        <section className="stack">
          <div className="section-head"><h3>Ledger</h3><span className="faint">Append-only · each line carries its hash</span></div>
          <Ledger s={s} />
        </section>
        <Receipt s={s} />
      </div>
    </div>
  );
}
