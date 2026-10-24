import type { Money } from './mandate.ts';
import type { PaymentRail } from './execute.ts';

export const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  returnUrl: string;
  cancelUrl: string;
  /** Sandbox test card used for "direct" purchases under the approval threshold. */
  testCard?: { number: string; expiry: string; securityCode: string; name: string };
}

const DEFAULT_TEST_CARD = { number: '4111111111111111', expiry: '2030-12', securityCode: '123', name: 'Mandat Demo' };

function amountValue(m: Money): string {
  return (m.minor / 100).toFixed(2);
}

export class PayPalError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly debugId: string | null;

  constructor(status: number, body: unknown, debugId: string | null) {
    super(`PayPal ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.debugId = debugId;
  }
}

/** Minimal PayPal REST client: OAuth token cache, JSON calls, PayPal-Request-Id on every write. */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly cfg: Pick<PayPalConfig, 'clientId' | 'clientSecret' | 'baseUrl'>;
  readonly baseUrl: string;

  constructor(cfg: Pick<PayPalConfig, 'clientId' | 'clientSecret' | 'baseUrl'>) {
    this.cfg = cfg;
    this.baseUrl = cfg.baseUrl ?? PAYPAL_SANDBOX;
  }

  get isSandbox(): boolean {
    return this.baseUrl === PAYPAL_SANDBOX;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const r = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new PayPalError(r.status, j, r.headers.get('paypal-debug-id'));
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 0) * 1000 };
    return j.access_token;
  }

  /**
   * Retries transient failures (network error, 429, 5xx, truncated body) only when the call is
   * safe to repeat: reads, or writes carrying a PayPal-Request-Id (PayPal deduplicates them).
   */
  async request<T = any>(method: string, path: string, body?: unknown, requestId?: string, attempts = 3): Promise<T> {
    const retryable = method === 'GET' || Boolean(requestId);
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' };
      if (requestId) headers['PayPal-Request-Id'] = requestId;
      let status = 0;
      let debugId: string | null = null;
      let json: unknown;
      try {
        const r = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        status = r.status;
        debugId = r.headers.get('paypal-debug-id');
        const text = await r.text();
        json = text ? JSON.parse(text) : {};
        if (r.ok) return json as T;
      } catch (e) {
        if (!retryable || attempt >= attempts) throw e;
        await new Promise(res => setTimeout(res, 500 * attempt));
        continue;
      }
      const transient = status === 429 || status >= 500;
      if (!transient || !retryable || attempt >= attempts) throw new PayPalError(status, json, debugId);
      await new Promise(res => setTimeout(res, 500 * attempt));
    }
  }

  /** multipart/form-data call used by the dispute endpoints: a JSON "input" part plus an optional file. */
  async multipart<T = any>(path: string, input: unknown, file?: { name: string; bytes: Uint8Array; type: string }): Promise<T> {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    if (file) form.append('file1', new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
    const r = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}` }, body: form });
    const text = await r.text();
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw new PayPalError(r.status, json, r.headers.get('paypal-debug-id'));
    return json as T;
  }
}

/** PaymentRail backed by PayPal Orders v2. */
export class PayPalRail implements PaymentRail {
  readonly client: PayPalClient;
  private readonly cfg: PayPalConfig;

  constructor(cfg: PayPalConfig) {
    this.cfg = cfg;
    this.client = new PayPalClient(cfg);
  }

  async createOrder(input: Parameters<PaymentRail['createOrder']>[0]) {
    const unit = {
      reference_id: 'default',
      custom_id: input.customId,
      description: input.description,
      amount: { currency_code: input.amount.currency, value: amountValue(input.amount) },
    };
    let payment_source: unknown;
    if (input.mode === 'direct') {
      if (!this.client.isSandbox) throw new Error('direct test-card payments are sandbox-only');
      const c = this.cfg.testCard ?? DEFAULT_TEST_CARD;
      payment_source = { card: { number: c.number, expiry: c.expiry, security_code: c.securityCode, name: c.name } };
    } else {
      payment_source = { paypal: { experience_context: {
        return_url: this.cfg.returnUrl, cancel_url: this.cfg.cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
      } } };
    }
    const o = await this.client.request('POST', '/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [unit], payment_source }, input.requestId);
    const approveUrl: string | undefined = o.links?.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    const captureId: string | undefined = o.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    return { orderId: o.id as string, status: o.status as string, approveUrl, captureId };
  }

  async captureOrder(orderId: string, requestId: string) {
    const o = await this.client.request('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, requestId);
    const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
    return { status: (cap?.status ?? o.status) as string, captureId: cap?.id as string | undefined, payerId: o.payer?.payer_id as string | undefined };
  }

  getOrder(orderId: string) {
    return this.client.request('GET', `/v2/checkout/orders/${orderId}`);
  }

  /** Attach shipment tracking to a captured order (used as proof of fulfilment in disputes). */
  addTracking(orderId: string, captureId: string, carrier: string, trackingNumber: string, requestId: string) {
    return this.client.request('POST', `/v2/checkout/orders/${orderId}/track`, {
      capture_id: captureId, tracking_number: trackingNumber, carrier: 'OTHER', carrier_name_other: carrier, notify_payer: false,
    }, requestId);
  }
}
