import { NextResponse } from 'next/server';
import { hasLiveAccess } from '@/lib/access';
import { sessionState } from '@/lib/state';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const state = sessionState((await ctx.params).id);
  if (!state) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ...state, live: await hasLiveAccess() }, { headers: { 'Cache-Control': 'no-store' } });
}
