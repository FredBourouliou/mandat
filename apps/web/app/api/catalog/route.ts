import { NextResponse } from 'next/server';
import { formatMoney } from '@mandat/guard';
import { searchCatalog } from '@/lib/catalog';

/** The demo merchant's catalogue, for external agents. Listings are third-party text: some hide instructions on purpose. */
export function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 100);
  return NextResponse.json(searchCatalog(q).map(p => ({
    sku: p.sku, title: p.title, category: p.category, seller: p.merchant, price: formatMoney(p.price), description: p.description,
  })));
}
