import Link from 'next/link';
import { MerchantOverview } from '@/components/overview';
import { hasLiveAccess } from '@/lib/access';
import { merchantOverview } from '@/lib/overview';

export const dynamic = 'force-dynamic';

export default async function MerchantBackOffice() {
  const all = merchantOverview();
  // Public visitors see the aggregate; payer and order ids, sandbox as they are, stay with access-code holders.
  const data = (await hasLiveAccess()) ? all : { ...all, orders: all.orders.map(o => ({ ...o, orderId: `${o.orderId.slice(0, 8)}…`, payer: o.payer && 'hidden' })) };
  return (
    <div className="stack">
      <header className="stack">
        <h1>Atelier Voyage back office</h1>
        <p className="muted">Every order placed by an AI agent across {data.mandates} mandates on this sandbox, with how it was authorized, and every purchase the guard refused. Read from the sealed ledgers. No real money.</p>
        <p><Link href="/">Back to Mandat</Link></p>
      </header>
      <MerchantOverview data={data} />
    </div>
  );
}
