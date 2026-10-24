import Link from 'next/link';
import { hasLiveAccess } from '@/lib/access';
import { DEMO_SESSION_ID } from '@/lib/env';
import { AccessForm, MandateForm } from '@/components/start';

// Access depends on the request cookie, never on build-time state.
export const dynamic = 'force-dynamic';

function DemoChoice() {
  return (
    <section className="deed" aria-labelledby="demo-title">
      <h2 id="demo-title">See it in action</h2>
      <p className="muted">No code needed. A complete run, recorded on the PayPal sandbox:</p>
      <ol className="steps">
        <li>The agent buys within the mandate.</li>
        <li>A prompt injection hidden in a listing is blocked.</li>
        <li>A human approves a purchase in PayPal.</li>
        <li>A chargeback is answered with the sealed receipt.</li>
      </ol>
      <p><Link className="btn btn-seal" href={`/s/${DEMO_SESSION_ID}`}>Open the recorded run</Link></p>
    </section>
  );
}

export default async function Home() {
  const live = await hasLiveAccess();
  return (
    <div className="stack-lg">
      <section className="stack narrow">
        <h1>Every purchase your AI makes, provable.</h1>
        <p className="lede">
          Sign the rules once: merchant, budget, approval threshold. Claude proposes purchases, a deterministic guard enforces
          your mandate and pays through PayPal, and every decision is sealed into a receipt the merchant can show if the payment is disputed.
        </p>
      </section>
      {live ? (
        <div className="stack">
          <MandateForm />
          {DEMO_SESSION_ID && <p className="faint">Or <Link href={`/s/${DEMO_SESSION_ID}`}>open the recorded run</Link> first.</p>}
        </div>
      ) : (
        <div className="choices">
          {DEMO_SESSION_ID && <DemoChoice />}
          <AccessForm />
        </div>
      )}
      <section className="stack narrow" aria-labelledby="who-title">
        <h2 id="who-title" className="h-sub">Who decides what</h2>
        <ol role="list" className="ledger" aria-labelledby="who-title">
          <li><span className="seq">1</span><span className="what"><strong>The agent proposes</strong><span className="faint">Claude searches the catalogue. It has no payment authority.</span></span><span className="actor">Claude</span></li>
          <li><span className="seq">2</span><span className="what"><strong>The guard decides</strong><span className="faint">Merchant, category, per-purchase and total limits, dates, number of purchases. An instruction to the agent cannot widen them.</span></span><span className="actor">Code</span></li>
          <li><span className="seq">3</span><span className="what"><strong>You approve</strong><span className="faint">Above your threshold, PayPal asks you directly.</span></span><span className="actor">You</span></li>
          <li><span className="seq">4</span><span className="what"><strong>PayPal records</strong><span className="faint">The mandate hash travels with the order as its custom_id.</span></span><span className="actor">PayPal</span></li>
        </ol>
      </section>
    </div>
  );
}
