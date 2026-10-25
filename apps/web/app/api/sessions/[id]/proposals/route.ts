import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, hasLiveAccess } from '@/lib/access';
import { consume } from '@/lib/db';
import { proposer } from '@/lib/agent';
import { agentEvents, getSession, logAgent } from '@/lib/store';

const Body = z.object({
  run: z.string().regex(/^mcp_[a-z0-9]{8,24}$/),
  client: z.string().trim().max(60).optional(),
  sku: z.string().max(60),
  quantity: z.number().int().min(1).max(10),
  reason: z.string().trim().min(1).max(200),
});

/**
 * A purchase proposal from an external agent (the MCP server in packages/mcp-guard). Same path as the built-in
 * agent: price and seller come from the catalogue, the guard decides, nothing here can pay outside the mandate.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await hasLiveAccess())) return NextResponse.json({ error: 'An access code is required for live runs.' }, { status: 403 });
  if (!getSession(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid proposal.' }, { status: 400 });
  if (!consume(`proposal:${id}`, 30) || !consume(`proposal-ip:${await clientIp()}`, 100)) {
    return NextResponse.json({ error: 'Proposal limit reached for today.' }, { status: 429 });
  }
  const { run, client, ...proposal } = parsed.data;
  if (!agentEvents(id).some(e => e.runId === run)) {
    logAgent(id, run, 'task', { task: `${client || 'An external agent'} connected over MCP. It can only propose; the guard decides.`, source: 'mcp' });
  }
  return NextResponse.json(await proposer(id, run)(proposal));
}
