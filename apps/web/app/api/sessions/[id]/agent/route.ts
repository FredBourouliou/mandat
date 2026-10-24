import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, hasLiveAccess } from '@/lib/access';
import { consume } from '@/lib/db';
import { runAgent } from '@/lib/agent';
import { running } from '@/lib/state';
import { getSession } from '@/lib/store';

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await hasLiveAccess())) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!getSession(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const parsed = z.object({ task: z.string().trim().min(3).max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Write a task of 3 to 300 characters.' }, { status: 400 });
  if (running.has(id)) return NextResponse.json({ error: 'The agent is already working on this mandate.' }, { status: 409 });
  if (!consume(`run:${id}`, 6) || !consume(`run-ip:${await clientIp()}`, 30) || !consume('run-global', 300)) {
    return NextResponse.json({ error: 'Run limit reached for today. The recorded demo is still available.' }, { status: 429 });
  }
  running.add(id);
  try {
    await runAgent(id, parsed.data.task);
  } finally {
    running.delete(id);
  }
  return NextResponse.json({ ok: true });
}
