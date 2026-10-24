'use client';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type Result = { valid: boolean; reason?: string; entries?: number; keyId?: string };

/** The answer first, then the two checks behind it, then what a seal does not prove. */
function Verdict({ r }: { r: Result }) {
  const reason = r.reason ?? '';
  const chainBroken = /^entry|^head/.test(reason);
  const badSignature = reason.startsWith('signature');
  return (
    <section className={`notice reveal ${r.valid ? '' : 'notice-seal'}`} role="status" aria-labelledby="verdict-title">
      <h2 id="verdict-title" className="h-sub">{r.valid ? 'Receipt intact' : 'Receipt rejected'}</h2>
      {!r.valid && !chainBroken && !badSignature && <p>{reason}</p>}
      <dl className="terms">
        <dt>Hash chain</dt><dd>{r.valid ? <><span className="verdict verdict-allow">Intact</span> {r.entries} entries</> : chainBroken ? <span className="verdict verdict-deny">Broken</span> : badSignature ? <span className="verdict verdict-allow">Intact</span> : 'not checked'}</dd>
        <dt>Signature</dt><dd>{r.valid ? <><span className="verdict verdict-allow">Valid</span> key <code>{r.keyId}</code></> : badSignature ? <span className="verdict verdict-deny">Does not match</span> : 'not checked'}</dd>
      </dl>
      {chainBroken && <p className="faint">{reason}.</p>}
      <p className="faint">A valid seal proves the receipt was not altered since this Mandat deployment signed it. It does not prove that what it records is true on its own: PayPal's records of the same order (custom_id, capture, tracking) back that up.</p>
    </section>
  );
}

export function VerifyForm({ demoSession }: { demoSession: string }) {
  const fromRun = useSearchParams().get('session');
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState('');

  const check = useCallback(async (body: string) => {
    const r = await fetch('/api/verify', { method: 'POST', body });
    setResult(await r.json());
  }, []);

  const load = useCallback(async (session: string) => {
    const r = await fetch(`/api/sessions/${encodeURIComponent(session)}/receipt`, { cache: 'no-store' });
    if (!r.ok) { setNote('This run has no receipt.'); return; }
    const body = JSON.stringify(await r.json(), null, 2);
    setText(body); setNote('Receipt loaded from the run.');
    void check(body);
  }, [check]);

  useEffect(() => { if (fromRun) void load(fromRun); }, [fromRun, load]);

  // Changes one digit inside the last entry's data, the way a forger would.
  const tamper = () => {
    try {
      const r = JSON.parse(text);
      const last = r.entries.at(-1);
      const json = JSON.stringify(last.data);
      const i = json.search(/[0-9]/);
      if (i < 0) return;
      const digit = json[i] === '9' ? '8' : String(Number(json[i]) + 1);
      last.data = JSON.parse(json.slice(0, i) + digit + json.slice(i + 1));
      const next = JSON.stringify(r, null, 2);
      setText(next); setNote(`Changed one digit in entry #${last.seq} (${last.type}).`);
      void check(next);
    } catch { setResult({ valid: false, reason: 'not valid JSON' }); }
  };

  const edit = (v: string) => { setText(v); setResult(null); setNote(''); };
  return (
    <div className="stack">
      {!text && (fromRun || demoSession) && (
        <div className="btn-row">
          <button className="btn btn-quiet" onClick={() => load(fromRun || demoSession)}>Load the {fromRun ? "run's" : 'recorded demo'} receipt</button>
        </div>
      )}
      {result && <Verdict r={result} />}
      <label>Receipt JSON
        <textarea value={text} onChange={e => edit(e.target.value)} rows={12} spellCheck={false} className="mono-area" placeholder='{"mandateHash": "…", "entries": [ … ], "signature": "…"}' />
      </label>
      <div className="btn-row">
        <button className="btn" disabled={!text.trim()} onClick={() => check(text)}>Verify</button>
        <button className="btn btn-quiet" disabled={!text.trim()} onClick={tamper}>Tamper with one byte</button>
        <label className="file-pick">
          <input type="file" accept="application/json,.json" onChange={async e => { const f = e.target.files?.[0]; if (f) edit(await f.text()); }} />
          <span>Open a .json file</span>
        </label>
      </div>
      {note && <p className="faint">{note}</p>}
    </div>
  );
}
