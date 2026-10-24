import 'server-only';
import { requestIdFor, sha256Hex, type Guard } from '@mandat/guard';
import { railFor, saveLedger } from './store';

/**
 * The demo merchant ships every paid order and attaches tracking to the PayPal order,
 * which later serves as proof of fulfilment.
 */
export async function ship(sessionId: string, guard: Guard, orderId: string, captureId: string): Promise<void> {
  if (guard.ledger.entries.some(e => e.type === 'shipment.tracked' && (e.data as { orderId?: string }).orderId === orderId)) return;
  const trackingNumber = `AV${sha256Hex(orderId).slice(0, 10).toUpperCase()}FR`;
  const carrier = 'Colissimo';
  await railFor(sessionId).addTracking(orderId, captureId, carrier, trackingNumber, requestIdFor(guard.mandate.id, orderId, 'track'));
  guard.record('shipment.tracked', { orderId, captureId, carrier, trackingNumber, by: 'atelier-voyage' });
  saveLedger(sessionId, guard);
}
