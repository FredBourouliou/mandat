import Link from 'next/link';
import { MerchantOverview } from '@/components/overview';
import { merchantOverview } from '@/lib/overview';

export const dynamic = 'force-dynamic';

export default function MerchantBackOffice() {
  const data = merchantOverview();
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
