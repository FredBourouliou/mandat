'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Polls the session state; faster while something is in flight. */
export function useSession<T extends { running: boolean }>(id: string, fast: (s: T) => boolean) {
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState('');
  const fastRef = useRef(fast);
  fastRef.current = fast;
  const load = useCallback(async () => {
    const r = await fetch(`/api/sessions/${id}`, { cache: 'no-store' });
    if (!r.ok) { setError(r.status === 404 ? 'This mandate does not exist.' : 'Could not load the mandate.'); return null; }
    const s = (await r.json()) as T;
    setState(s);
    return s;
  }, [id]);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = await load().catch(() => null);
      if (!stop) timer = setTimeout(tick, s && (s.running || fastRef.current(s)) ? 1200 : 5000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [load]);
  return { state, error, reload: load };
}

export async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}
