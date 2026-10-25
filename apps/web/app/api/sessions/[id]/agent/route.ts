import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canAct, clientIp } from '@/lib/access';
import { consume } from '@/lib/db';
import { runAgent } from '@/lib/agent';
import { running } from '@/lib/state';
import { getSession } from '@/lib/store';

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await canAct(id))) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!getSession(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const parsed = z.object({ task: z.string().trim().min(3).max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Write a task of 3 to 300 characters.' }, { status: 400 });
  if (running.has(id)) return NextResponse.json({ error: 'The agent is already working on this mandate.' }, { status: 409 });
  running.add(id);
  try {
    if (!consume(`run:${id}`, 6) || !consume(`run-ip:${await clientIp()}`, 30) || !consume('run-global', 300)) {
      return NextResponse.json({ error: 'Run limit reached for today. The recorded demo is still available.' }, { status: 429 });
    }
    const persona = req.headers.get('x-mandat-persona');
    // Test personas are ignored unless the local server runs with MANDAT_TEST_HARNESS=1 (see lib/agent.ts).
    const script = z.array(z.object({ sku: z.string().max(60), quantity: z.number().int().min(1).max(10) })).max(10)
      .safeParse((() => { try { return JSON.parse(req.headers.get('x-mandat-script') ?? '[]'); } catch { return []; } })());
    await runAgent(id, parsed.data.task, persona === 'obedient' || persona === 'compromised' ? persona : 'default', script.success ? script.data : []);
  } finally {
    running.delete(id);
  }
  return NextResponse.json({ ok: true });
}
