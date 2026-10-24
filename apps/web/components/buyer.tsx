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

/** Agent text is shown as plain prose: no markdown markers, list dashes become bullets. */
function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, '').replace(/^\s*[-*]\s+/gm, '• ').trim();
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function MandateTerms({ s }: { s: SessionState }) {
  const m = s.mandate;
  const paid = s.orders.filter(o => o.state === 'paid').reduce((t, o) => t + o.amount.minor, 0);
  const reserved = s.spent.total.minor - paid;
  const eur = (minor: number) => money({ currency: m.maxTotal.currency, minor });
  return (
    <section className="deed" aria-labelledby="mandate-title">
      <div className="stack" style={{ gap: 'var(--space-2xs)' }}>
        <h1 id="mandate-title" className="h-doc">{m.purpose}</h1>
        <p className="faint">Spending mandate signed {new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
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
        Paid <strong className="ink">{eur(paid)}</strong>{reserved > 0 ? <>, waiting for approval {eur(reserved)}</> : null}. Left {eur(m.maxTotal.minor - s.spent.total.minor)}.
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

/** One line per request, per proposal (with the guard's verdict) and the agent's summary. Searches are left to the ledger. */
function AgentLog({ s }: { s: SessionState }) {
  if (!s.agent.length) return <p className="faint">No task yet. Pick an example or write your own: the agent searches the catalogue and proposes purchases, the guard decides.</p>;
  const lines: { key: number; who: string; body: React.ReactNode; sep?: boolean }[] = [];
  let run = '';
  // Older runs log the proposal separately: pair them in order when the guard line does not carry the item.
  const pending: any[] = [];
  // Approvals happen after the agent has finished its run: shown after its summary.
  const later: typeof lines = [];
  for (const e of s.agent) {
    const d = e.data as any;
    const sep = e.runId !== run && run !== '';
    run = e.runId;
    if (e.kind === 'task') lines.push({ key: e.seq, who: 'You', body: <strong>{d.task}</strong>, sep });
    else if (e.kind === 'proposal') pending.push(d);
    else if (e.kind === 'guard') {
      const proposal = d.title ? d : pending.shift();
      if (d.title) pending.shift();
      const what = proposal ? <>{proposal.title} ×{proposal.quantity}, {proposal.unitPrice}{proposal.merchant !== 'atelier-voyage' ? <span className="faint"> · sold by {proposal.merchant}</span> : null}</> : null;
      const verdict = d.status === 'denied' ? <><span className="verdict verdict-deny">Blocked</span><span className="sr-only">: </span> {what}<span className="block faint">{d.reasons.join('; ')}</span></>
        : d.status === 'paid' ? <><span className="verdict verdict-allow">Paid</span><span className="sr-only">: </span> {what}</>
        : d.status === 'awaiting_approval' ? <><span className="verdict verdict-pending">Approval</span><span className="sr-only">: </span> {what}<span className="block faint">Above the approval threshold: PayPal asks the buyer.</span></>
        : <><span className="verdict verdict-deny">Failed</span><span className="sr-only">: </span> {what}<span className="block faint">{d.reason}</span></>;
      lines.push({ key: e.seq, who: 'Guard', body: verdict });
      // The human step happens in PayPal, outside the agent: show it where the story needs it.
      const captured = d.status === 'awaiting_approval' && s.ledger.find(x => x.type === 'order.captured' && (x.data as any).orderId === d.orderId);
      if (captured) {
        const c = captured.data as any;
        later.push({ key: e.seq + 0.5, who: 'You', body: c.status === 'COMPLETED'
          ? <><span className="verdict verdict-allow">Paid</span><span className="sr-only">: </span> approved in PayPal at {time(captured.at)}<span className="block faint">Payer {c.payerId} · capture {c.captureId}</span></>
          : <><span className="verdict verdict-deny">Failed</span><span className="sr-only">: </span> capture {c.status}</> });
      }
    } else if (e.kind === 'done') {
      lines.push({ key: e.seq, who: 'Agent', body: <span className="prose">{plain(d.text)}</span> });
      lines.push(...later.splice(0));
    }
    else if (e.kind === 'error') lines.push({ key: e.seq, who: 'Error', body: <span className="error">{d.message}</span> });
  }
  lines.push(...later);
  if (s.running) lines.push({ key: -1, who: 'Agent', body: <span className="working">Searching the catalogue and proposing</span> });
  return (
    <ul className="log" aria-live="polite">
      {lines.map(l => (
        <li key={l.key} className="reveal">
          {l.sep && <span className="run-sep" aria-hidden="true" />}
          <span className="who">{l.who}<span className="sr-only">: </span></span><span>{l.body}</span>
        </li>
      ))}
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
        {SCENARIOS.map(x => <button key={x.label} className="btn btn-quiet" aria-disabled={s.running} onClick={() => { if (!s.running) void run(x.task); }}>{x.label}</button>)}
      </div>
      <form className="btn-row" onSubmit={e => { e.preventDefault(); if (task.trim() && !s.running) void run(task.trim()); }}>
        <label style={{ flex: '1 1 320px' }}>Or write a task
          <input value={task} onChange={e => setTask(e.target.value)} maxLength={300} placeholder="e.g. Find me packing cubes and a travel adapter" readOnly={s.running} />
        </label>
        <button className="btn" style={{ alignSelf: 'end' }} aria-disabled={s.running || !task.trim()}>{s.running ? 'Agent working…' : 'Send to agent'}</button>
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
      {waiting.map(o => s.live ? (
        <section key={o.orderId} className="notice notice-pending reveal" aria-live="polite">
          <p><strong>Your approval is needed: {o.proposal.title} ×{o.proposal.quantity}, {money(o.amount)}</strong>, above your {money(s.mandate.approvalAbove)} threshold.</p>
          <div className="btn-row">
            <a className="btn" href={o.approveUrl}>Review and approve in PayPal</a>
            <span className="faint">PayPal sandbox order {o.orderId}. You come back here once approved.</span>
          </div>
        </section>
      ) : (
        <p key={o.orderId} className="faint">{o.proposal.title} ({money(o.amount)}) was still waiting for the buyer's approval in PayPal when this run was recorded.</p>
      ))}
    </>
  );
}

/** The proof, first: what was paid, held or blocked, and the sealed receipt behind it. */
function ReceiptSummary({ s }: { s: SessionState }) {
  const paid = s.orders.filter(o => o.state === 'paid');
  const held = s.orders.filter(o => o.state === 'awaiting_approval');
  const blocked = s.ledger.filter(e => e.type === 'decision' && (e.data as { kind?: string }).kind === 'deny').length;
  return (
    <section className="deed deed-receipt" aria-labelledby="receipt-title">
      <div className="receipt-head">
        <div className="stack" style={{ gap: 'var(--space-xs)' }}>
          <h2 id="receipt-title">Sealed receipt</h2>
          <p className="verdict-line">
            <span><strong>{plural(paid.length, 'paid order')}</strong></span>
            {held.length > 0 && <span>{plural(held.length, 'awaiting approval', 'awaiting approval')}</span>}
            <span>{plural(blocked, 'proposal')} blocked</span>
          </p>
          <p className="muted">{plural(s.ledger.length, 'entry', 'entries')}, each hash-chained to the previous one, signed together with Ed25519. Any change breaks the signature.</p>
        </div>
        <span className="seal-mark" aria-hidden="true">Ed25519<br />sealed</span>
      </div>
      <div className="btn-row">
        <a className="btn" href={`/api/sessions/${s.id}/receipt?format=pdf`} target="_blank" rel="noopener">Evidence pack (PDF)</a>
        <Link className="btn btn-quiet" href={`/verify?session=${encodeURIComponent(s.id)}`}>Verify this receipt</Link>
        <a href={`/api/sessions/${s.id}/receipt`} target="_blank" rel="noopener">JSON</a>
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
        <p className="faint">Merchant side: <Link href={`/s/${id}/merchant`}>Atelier Voyage dashboard and disputes</Link></p>
      </aside>
      <div className="stack-lg">
        {!s.live && <ReplayBanner />}
        {approval === 'captured' && <p className="notice reveal" role="status">PayPal confirmed your approval. The guard captured the payment once and Atelier Voyage shipped the order.</p>}
        {approval === 'cancelled' && <p className="notice reveal" role="status">You cancelled in PayPal. Nothing was charged.</p>}
        <ReceiptSummary s={s} />
        {s.live && (
          <section className="stack">
            <div className="section-head"><h2>Ask the agent</h2><span className="faint">Claude Sonnet 5.5 · proposes only</span></div>
            <TaskBox s={s} onRun={reload} />
          </section>
        )}
        <Approvals s={s} />
        <section className="stack">
          <h2 className="h-sub">What happened</h2>
          <AgentLog s={s} />
        </section>
        <details className="ledger-details">
          <summary>Show the {s.ledger.length} sealed ledger entries</summary>
          <Ledger s={s} />
        </details>
      </div>
    </div>
  );
}
