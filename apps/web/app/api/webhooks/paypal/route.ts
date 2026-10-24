import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { paypal, PAYPAL_WEBHOOK_ID } from '@/lib/env';
import { refreshDispute } from '@/lib/disputes';

/** PayPal webhooks: signature verified with PayPal, deduplicated by event id, acknowledged quickly. */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!event?.id || !PAYPAL_WEBHOOK_ID) return NextResponse.json({ error: 'not configured' }, { status: 400 });

  const h = req.headers;
  const check = await paypal().request('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h.get('paypal-auth-algo'), cert_url: h.get('paypal-cert-url'), transmission_id: h.get('paypal-transmission-id'),
    transmission_sig: h.get('paypal-transmission-sig'), transmission_time: h.get('paypal-transmission-time'),
    webhook_id: PAYPAL_WEBHOOK_ID, webhook_event: event,
  }).catch(() => null);
  const verified = check?.verification_status === 'SUCCESS';
  if (!verified) return NextResponse.json({ error: 'signature' }, { status: 401 });

  const disputeId: string | undefined = event.resource?.dispute_id;
  const inserted = db.prepare('INSERT OR IGNORE INTO webhook_events (id, type, resource_id, received_at, verified, body) VALUES (?, ?, ?, ?, 1, ?)')
    .run(event.id, event.event_type, disputeId ?? event.resource?.id ?? null, new Date().toISOString(), raw).changes;
  if (inserted && disputeId && String(event.event_type).startsWith('CUSTOMER.DISPUTE.')) {
    db.prepare('UPDATE disputes SET first_webhook_at = COALESCE(first_webhook_at, ?) WHERE id = ?').run(new Date().toISOString(), disputeId);
    void refreshDispute(disputeId);
  }
  return NextResponse.json({ ok: true });
}
