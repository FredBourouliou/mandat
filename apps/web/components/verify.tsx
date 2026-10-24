'use client';
import { useState } from 'react';

type Result = { valid: boolean; reason?: string; entries?: number; keyId?: string };

export function VerifyForm() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [tampered, setTampered] = useState('');
  const check = async (body: string) => {
    const r = await fetch('/api/verify', { method: 'POST', body });
    setResult(await r.json());
  };
  // Changes one character inside the last entry's data, the way a forger would.
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
      setText(next); setTampered(`Changed one digit in entry #${last.seq} (${last.type}).`);
      void check(next);
    } catch { setResult({ valid: false, reason: 'not valid JSON' }); }
  };
  return (
    <div className="stack">
      <label>Receipt JSON
        <textarea value={text} onChange={e => { setText(e.target.value); setResult(null); setTampered(''); }} rows={12} spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }} placeholder='{"mandateHash": "…", "entries": [ … ], "signature": "…"}' />
      </label>
      <label className="faint" style={{ fontWeight: 400 }}>Or load a file
        <input type="file" accept="application/json,.json" onChange={async e => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setResult(null); setTampered(''); } }} />
      </label>
      <div className="btn-row">
        <button className="btn" disabled={!text.trim()} onClick={() => check(text)}>Verify</button>
        <button className="btn btn-quiet" disabled={!text.trim()} onClick={tamper}>Tamper with one byte</button>
      </div>
      {tampered && <p className="faint">{tampered}</p>}
      {result && (
        <p className={`notice reveal ${result.valid ? '' : 'notice-seal'}`} role="status">
          {result.valid
            ? <><span className="verdict verdict-allow">Valid</span> {result.entries} entries, chain intact, signature by key <code>{result.keyId}</code>.</>
            : <><span className="verdict verdict-deny">Invalid</span> {result.reason}</>}
        </p>
      )}
    </div>
  );
}
