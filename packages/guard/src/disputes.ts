import type { Money } from './mandate.ts';
import { PayPalError, type PayPalClient } from './paypal.ts';

export interface DisputeView {
  id: string;
  status: string;
  stage: string;
  reason: string;
  amount?: Money;
  /** Actions PayPal currently allows the seller (e.g. provide_evidence, provide_supporting_info, accept_claim). */
  actions: string[];
  outcome?: string;
  captureIds: string[];
  updatedAt?: string;
}

function toMoney(a?: { currency_code: string; value: string }): Money | undefined {
  return a ? { currency: a.currency_code, minor: Math.round(Number(a.value) * 100) } : undefined;
}

export async function getDispute(client: PayPalClient, id: string): Promise<DisputeView> {
  const d = await client.request('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
  return {
    id: d.dispute_id,
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    reason: d.reason,
    amount: toMoney(d.dispute_amount),
    actions: (d.links ?? []).map((l: { rel: string }) => l.rel).filter((r: string) => r !== 'self'),
    outcome: d.dispute_outcome?.outcome_code,
    captureIds: (d.disputed_transactions ?? []).map((t: { seller_transaction_id?: string }) => t.seller_transaction_id).filter(Boolean),
    updatedAt: d.update_time,
  };
}

/**
 * Sandbox-only: makes PayPal open a card chargeback on a capture, as a cardholder's bank would.
 * Returns the dispute id at once; the CUSTOMER.DISPUTE.CREATED webhook follows about 3 minutes later.
 */
export async function simulateChargeback(client: PayPalClient, captureId: string, amount: Money): Promise<string> {
  if (!client.isSandbox) throw new Error('chargeback simulation is sandbox-only');
  const now = new Date();
  const value = { currency_code: amount.currency, value: (amount.minor / 100).toFixed(2) };
  const r = await client.request('POST', '/v2/customer-support/process-chargeback', {
    adjacency: 'PAYPAL', file_layout: 'ATCK_CB',
    financial_institution: { processor: 'FDMS' },
    transaction: { id_enc: captureId, amount: value },
    instrument: { instrument_type: 'CARD', card_brand: 'VISA', credit_card_transaction_id: `${now.getTime()}00`, external: false },
    dispute: {
      id: null, stage: 'CHARGEBACK', status: '2', amount: value,
      receive_date: now.toISOString(), money_movement_date: now.toISOString(),
      response_date: new Date(now.getTime() + 10 * 864e5).toISOString(),
      event_code: 'CHARGEBACK_INITIATED', event_type: 'DEBIT', chargeback_type: 'REPORTED_TO_PROCESSOR',
      processor_info: { reference_number: `${now.getTime()}0000000000`, reason_code: '1330', notes: 'Cardholder does not recognise the purchase' },
    },
  });
  return r.dispute_id as string;
}

export interface DisputeResponse {
  notes: string;
  tracking?: { carrier: string; number: string };
  pdf: Uint8Array;
}

/**
 * PayPal lists a response action a little before it accepts it: an early call fails with 400
 * MISSING_OR_INVALID_REQUEST_BODY (observed in sandbox, the same request passes ~20 s later).
 * Nothing is recorded on a 400, so retrying is safe.
 */
async function whenAccepted<T>(call: () => Promise<T>, attempts = 4, delayMs = 10_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (e) {
      const early = e instanceof PayPalError && e.status === 400 && JSON.stringify(e.body).includes('MISSING_OR_INVALID_REQUEST_BODY');
      if (!early || i >= attempts) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

/** Answers with whichever action PayPal currently offers. Returns the action used, or null if none is open yet. */
export async function respondToDispute(client: PayPalClient, dispute: DisputeView, res: DisputeResponse): Promise<string | null> {
  const file = { name: 'mandat-evidence.pdf', bytes: res.pdf, type: 'application/pdf' };
  if (dispute.actions.includes('provide_evidence')) {
    const evidence_info = res.tracking
      ? { tracking_info: [{ carrier_name: 'OTHER', carrier_name_other: res.tracking.carrier, tracking_number: res.tracking.number }] }
      : undefined;
    await whenAccepted(() => client.multipart(`/v1/customer/disputes/${encodeURIComponent(dispute.id)}/provide-evidence`, {
      evidences: [{ evidence_type: res.tracking ? 'PROOF_OF_FULFILLMENT' : 'OTHER', evidence_info, notes: res.notes }],
    }, file));
    return 'provide_evidence';
  }
  if (dispute.actions.includes('provide_supporting_info')) {
    await whenAccepted(() => client.multipart(`/v1/customer/disputes/${encodeURIComponent(dispute.id)}/provide-supporting-info`, { notes: res.notes }, file));
    return 'provide_supporting_info';
  }
  return null;
}
