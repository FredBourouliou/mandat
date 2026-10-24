import Link from 'next/link';
import { hasLiveAccess } from '@/lib/access';
import { DEMO_SESSION_ID } from '@/lib/env';
import { AccessForm, MandateForm } from '@/components/start';

// Access depends on the request cookie, never on build-time state.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const live = await hasLiveAccess();
  return (
    <div className="stack-lg">
      <section className="stack narrow">
        <h1>Let an AI agent shop for you, within limits you sign.</h1>
        <p className="lede">
          The agent proposes. A deterministic guard checks each purchase against your mandate and pays through PayPal.
          You approve anything above your threshold. Every step is sealed into a receipt the merchant can show if the payment is ever disputed.
        </p>
      </section>
      <ol className="ledger narrow" aria-label="Who decides what">
        <li><span className="seq">1</span><span className="what"><strong>The agent proposes</strong><span className="faint">Claude searches the catalogue. It has no payment authority.</span></span><span className="actor">Claude</span></li>
        <li><span className="seq">2</span><span className="what"><strong>The guard decides</strong><span className="faint">Merchant, category, per-purchase and total limits, dates, number of purchases.</span></span><span className="actor">Code</span></li>
        <li><span className="seq">3</span><span className="what"><strong>You approve</strong><span className="faint">Above your threshold, PayPal asks you directly.</span></span><span className="actor">You</span></li>
        <li><span className="seq">4</span><span className="what"><strong>PayPal records</strong><span className="faint">The mandate hash travels with the order as its custom_id.</span></span><span className="actor">PayPal</span></li>
      </ol>
      {live ? <MandateForm /> : (
        <>
          {DEMO_SESSION_ID && (
            <section className="stack narrow">
              <h2>Replay a recorded run</h2>
              <p className="muted">A complete run recorded on this deployment, read-only: real PayPal sandbox orders, a blocked prompt injection, a human approval, then a chargeback answered with the sealed receipt.</p>
              <p><Link className="btn" href={`/s/${DEMO_SESSION_ID}`}>Open the recorded run</Link></p>
            </section>
          )}
          <AccessForm />
        </>
      )}
    </div>
  );
}
