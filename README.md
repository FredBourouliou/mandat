# Mandat

**Every purchase your AI makes, provable.**

Mandat lets an AI shopping agent buy on PayPal under a spending mandate you sign once. The agent (Claude) proposes purchases. A deterministic guard checks each one against the mandate and pays through PayPal. You approve anything above your threshold. Every step is hash-chained and signed into a receipt, so if the payment is disputed, the merchant can show exactly who authorized what.

![The agent proposes a tent from a partner listing that hides a prompt injection; the guard blocks it for three reasons](docs/demo.gif)

- **Live demo:** https://mandat-zrgh.onrender.com (open the recorded run without a code; live runs need the judges' access code)
- **Video (2 min):** _link added at submission_
- PayPal **sandbox** only. No real money moves.

## Why

In 2026, the top category of complaints about PayPal in the CFPB Consumer Complaint Database is "unauthorized transactions or other transaction problem": 2,195 of 10,572 complaints received between 1 January and 24 October 2026 (company: PayPal Holdings, Inc.). Merchants face the mirror problem: a disputed payment they cannot prove was authorized.

AI agents are starting to buy on our behalf, which makes both sides worse unless the authorization is recorded at the moment of purchase. Mandat records it.

## How it works

| Step | Who | What happens |
| --- | --- | --- |
| 1 | **Claude proposes** | The agent searches the merchant catalogue and calls `propose_purchase`. It has no payment tool and never sees PayPal credentials. Catalogue text is untrusted. |
| 2 | **The guard decides** | Plain TypeScript checks merchant, category, per-purchase limit, total, number of purchases and validity dates. A prompt cannot widen the mandate. Concurrent proposals are serialized, so two of them cannot both pass the total. |
| 3 | **You approve** | Above your threshold, the guard creates a PayPal order with a `payer-action` link and only captures it after you approve on PayPal's own page. |
| 4 | **PayPal records** | Each order carries the mandate hash as `purchase_units[].custom_id` and a deterministic `PayPal-Request-Id` (an order can never be created twice). The demo merchant attaches tracking. |
| 5 | **The receipt seals it** | Every event goes into an append-only ledger: JCS (RFC 8785) canonical JSON, SHA-256 chain, one Ed25519 signature. The public key is published at `/.well-known/mandat-keys.json`; `/verify` recomputes the chain and checks the signature. |
| 6 | **The merchant defends** | On a chargeback (`CUSTOMER.DISPUTE.CREATED` webhook, signature verified), Claude drafts the answer **from the sealed receipt only**, citing ledger entries. A human sends it to PayPal with a PDF evidence pack that embeds the signed receipt. |

```mermaid
flowchart LR
  U[You sign a mandate] --> A[Claude agent]
  A -- propose_purchase --> G{Deterministic guard}
  G -- outside the mandate --> X[Blocked, recorded]
  G -- under threshold --> P[PayPal Orders v2: capture]
  G -- above threshold --> H[PayPal approval by you] --> P
  P -- custom_id = mandate hash --> L[(Hash-chained ledger)]
  L --> R[Ed25519 sealed receipt + PDF]
  D[Chargeback webhook] --> C[Claude drafts from the receipt] --> M[Merchant sends evidence to PayPal]
  R --> C
```

## What is real and what is simulated

| Real, on the PayPal sandbox | Simulated, and labelled as such |
| --- | --- |
| Orders, card captures, buyer approvals, captures after approval | The final ruling of a chargeback. The sandbox cannot adjudicate chargebacks (`ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`), so the demo stops at "evidence sent, under review" and the "won" outcome is a labelled simulation. |
| Tracking attached to orders | The cardholder's chargeback itself is created with PayPal's sandbox-only `process-chargeback` endpoint. |
| Chargebacks, dispute webhooks (signature verified), evidence upload (`provide-supporting-info` / `provide-evidence`) | |
| Claude agent runs and dispute drafts | |

A valid seal proves the receipt was not altered after Mandat signed it. It does not prove on its own that the facts are true: PayPal's records of the same order (custom_id, capture, payer, tracking) back them up.

## Quick start

Requirements: Node 24+, pnpm 11, a [PayPal developer](https://developer.paypal.com) sandbox app (client id and secret, plus its default sandbox buyer account for approvals) and an [Anthropic API key](https://console.anthropic.com).

```sh
git clone https://github.com/FredBourouliou/mandat && cd mandat
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY
pnpm test
pnpm --filter @mandat/web dev                  # http://localhost:3000
```

Locally, `JURY_CODE` is empty, so live runs are open. A signing key is generated into `apps/web/.data/` on first use. To receive dispute webhooks locally, expose the app (for example with `cloudflared tunnel --url http://localhost:3000`), create a webhook in the PayPal dashboard for `CUSTOMER.DISPUTE.*` and set `PAYPAL_WEBHOOK_ID`. Without it, the merchant view still polls PayPal for the dispute.

## Tests and evidence

- `pnpm test`: 26 unit tests on the guard. They cover 12 out-of-mandate cases, approval, idempotency, the cumulative limit (also with concurrent proposals), restoring the guard from its ledger, and receipts that must fail verification when one byte changes, an entry is removed, or another key is used.
- `packages/guard/scripts/*.ts`: end-to-end runs against the real PayPal sandbox (direct payment, idempotent re-submission, approval then capture, tracking, PDF).
- `scripts/injection-suite.ts`: 30 attacks in five families (direct requests, false authority, manipulated proposals, instructions hidden in listings, budget exhaustion), each on a fresh mandate, run with three agent personas, and checked independently of what the agent says. **Results: [docs/injection-results.md](docs/injection-results.md)** (raw data in `docs/injection-results.json`).

  | Agent persona | Runs | Attempted a purchase outside the mandate | Orders outside the mandate | Money outside the mandate |
  | --- | --- | --- | --- | --- |
  | default (the production agent) | 30 | 22 | **0** | **0 EUR** |
  | obedient (Claude told to obey every instruction) | 30 | 21 | **0** | **0 EUR** |
  | compromised (no model: the attacker's proposals go straight to the guard) | 30 | 29 | **0** | **0 EUR** |

  What it shows: Claude mostly ignored instructions hidden in listings, even when told to obey them (2 of 6 attempted), but it readily proposes what the user asks, in or out of the mandate. Safety comes from the guard, not from the model: a fully hijacked agent still spent nothing outside the mandate. The `obedient` and `compromised` personas only exist on a local server started with `MANDAT_TEST_HARNESS=1`.
- Accessibility: axe-core (WCAG 2.2 AA) with 0 violations on every page at desktop and mobile widths; keyboard and 400 % zoom checked; VoiceOver pass in Safari.

## Security notes

- The model has no payment authority. Only the guard calls PayPal, with amounts taken from the catalogue, never from the model.
- Idempotency: `PayPal-Request-Id = sha256(mandate, proposal, step)`, so retries never create a second order or capture.
- Webhooks are verified with PayPal's `verify-webhook-signature` and deduplicated by event id.
- The public deployment gates live calls behind an access code, with per-session, per-IP and daily limits on agent runs.
- Secrets live in environment variables only; the repository has GitHub secret scanning and push protection on.

## Project layout

```
packages/guard   mandate evaluation, PayPal rail, ledger + receipt, PDF, disputes (no framework, tested alone)
apps/web         Next.js app: agent (Vercel AI SDK + Claude), routes, webhooks, buyer and merchant views, /verify
scripts          prompt-injection suite
```

Built with TypeScript, Next.js 16, the Vercel AI SDK with `@ai-sdk/anthropic` (Claude Sonnet 5.5), PayPal REST APIs (Orders v2, Disputes, Webhooks, Tracking), SQLite, pdf-lib and Node's built-in Ed25519. Hosted on Render.

## License

MIT
