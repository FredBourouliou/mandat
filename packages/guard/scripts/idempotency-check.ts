// Same PayPal-Request-Id twice, straight to the rail (no local dedupe): PayPal must return the same order.
import { PayPalRail } from '../src/index.ts';
const env = (k: string) => process.env[k] ?? (() => { throw new Error(`missing ${k}`); })();
const rail = new PayPalRail({ clientId: env('PAYPAL_CLIENT_ID'), clientSecret: env('PAYPAL_CLIENT_SECRET'), returnUrl: 'https://example.com/r', cancelUrl: 'https://example.com/c' });
const input = { requestId: `idem-${Date.now()}`, customId: 'idempotency-check', description: 'idempotency check', amount: { currency: 'EUR', minor: 1500 }, mode: 'direct' as const };
const a = await rail.createOrder(input);
const b = await rail.createOrder(input);
console.log(a.orderId === b.orderId ? 'OK  same PayPal-Request-Id → same order, charged once' : `KO  two orders: ${a.orderId} / ${b.orderId}`);
const o = await rail.getOrder(a.orderId);
const trackers = o.purchase_units?.[0]?.shipping?.trackers ?? [];
console.log(`captures on that order: ${o.purchase_units?.[0]?.payments?.captures?.length ?? 0}`);
