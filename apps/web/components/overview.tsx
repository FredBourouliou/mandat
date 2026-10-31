'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ColDef, FilterChangedEvent, GridApi, ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import type { Overview, OverviewBlocked, OverviewOrder } from '@/lib/overview';
import { short, time } from './format';
import { gridTheme } from './grids';

const eur = (minor: number) => `${(minor / 100).toFixed(2)} EUR`;
const when = (at?: string) => (at ? `${at.slice(0, 10)} ${time(at)}` : '');
const Verdict = ({ kind, label }: { kind: string; label: string }) => <span className={`verdict verdict-${kind}`}>{label}</span>;
const defaults = { sortable: true, resizable: true, suppressMovable: true, filter: true };
const authKind: Record<string, string> = { 'Passkey and PayPal': 'allow', 'Buyer in PayPal': 'pending', 'Guard alone': 'neutral' };

/** The rows left after the filters: the totals follow what the merchant is looking at. */
function totals(api: GridApi<OverviewOrder>) {
  let paid = 0, count = 0, disputed = 0;
  api.forEachNodeAfterFilter(n => {
    if (!n.data) return;
    count++;
    if (n.data.status === 'Paid') paid += n.data.minor;
    if (n.data.dispute) disputed += n.data.minor;
  });
  return { paid, count, disputed };
}

export function MerchantOverview({ data }: { data: Overview }) {
  const [q, setQ] = useState('');
  const api = useRef<GridApi<OverviewOrder> | null>(null);
  const initial = useMemo(() => data.orders.reduce((t, o) => ({ count: t.count + 1, paid: t.paid + (o.status === 'Paid' ? o.minor : 0), disputed: t.disputed + (o.dispute ? o.minor : 0) }), { count: 0, paid: 0, disputed: 0 }), [data.orders]);
  const [shown, setShown] = useState(initial);
  const refresh = useCallback((e: FilterChangedEvent<OverviewOrder>) => setShown(totals(e.api)), []);

  const orderColumns = useMemo<ColDef<OverviewOrder>[]>(() => [
    { field: 'at', headerName: 'Date', width: 150, sort: 'desc', filter: 'agTextColumnFilter', valueFormatter: p => when(p.value) },
    { field: 'item', headerName: 'Item', flex: 1, minWidth: 290 },
    { field: 'minor', headerName: 'Amount', width: 120, filter: 'agNumberColumnFilter', filterValueGetter: p => (p.data?.minor ?? 0) / 100, valueFormatter: p => eur(p.value), cellClass: 'num' },
    { field: 'authorizedBy', headerName: 'Authorized by', width: 190, cellRenderer: (p: ICellRendererParams<OverviewOrder>) => p.value ? <Verdict kind={authKind[p.value] ?? 'neutral'} label={p.value} /> : null },
    { field: 'mandate', headerName: 'Mandate', width: 112 },
    { field: 'status', headerName: 'Status', width: 150 },
    { field: 'dispute', headerName: 'Dispute', width: 160, valueFormatter: p => (p.node?.isRowPinned() ? '' : p.value || '—') },
    { field: 'payer', headerName: 'PayPal payer', width: 150, valueFormatter: p => (p.node?.isRowPinned() ? '' : p.value || '—'), cellClass: 'mono-cell' },
    { field: 'orderId', headerName: 'PayPal order', width: 190, cellClass: 'mono-cell' },
    { field: 'mandateHash', headerName: 'Mandate hash', width: 140, valueFormatter: p => (p.value ? short(p.value, 12) : ''), cellClass: 'mono-cell' },
  ], []);

  const blockedColumns = useMemo<ColDef<OverviewBlocked>[]>(() => [
    { field: 'at', headerName: 'Date', width: 150, sort: 'desc', filter: 'agTextColumnFilter', valueFormatter: p => when(p.value) },
    { field: 'item', headerName: 'Proposal', flex: 1, minWidth: 320 },
    { field: 'minor', headerName: 'Amount', width: 130, filter: 'agNumberColumnFilter', filterValueGetter: p => (p.data?.minor ?? 0) / 100, valueFormatter: p => eur(p.value), cellClass: 'num' },
    { field: 'sellers', headerName: 'Seller', width: 170 },
    { field: 'rule', headerName: 'Rules broken', width: 340 },
    { field: 'reasons', headerName: 'Guard\'s reasons', flex: 2, minWidth: 320, tooltipField: 'reasons', cellClass: 'faint-cell' },
  ], []);

  const pinned = useMemo(() => [{ item: `${shown.count} orders shown`, minor: shown.paid } as OverviewOrder], [shown]);

  return (
    <>
      <section className="deed" aria-labelledby="orders-title">
        <h2 id="orders-title" className="h-sub">Orders placed by agents</h2>
        <dl className="terms" aria-live="polite">
          <dt>Orders shown</dt><dd>{shown.count}</dd>
          <dt>Paid</dt><dd>{eur(shown.paid)}</dd>
          <dt>Under dispute</dt><dd>{eur(shown.disputed)}</dd>
        </dl>
        <div className="btn-row">
          <label className="grid-search" style={{ flex: '1 1 320px' }}>Search the orders
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. jacket, Passkey, order id, payer" />
          </label>
          <button type="button" className="btn btn-quiet" style={{ alignSelf: 'end' }} onClick={() => api.current?.exportDataAsCsv({ fileName: 'mandat-orders.csv' })}>Export CSV</button>
        </div>
        <div className="grid-wrap" style={{ height: 520 }}>
          <AgGridReact<OverviewOrder> theme={gridTheme} rowData={data.orders} columnDefs={orderColumns} defaultColDef={{ ...defaults, floatingFilter: true }}
            quickFilterText={q} getRowId={p => p.data.rowId || `pinned-${p.data.item}`} pinnedBottomRowData={pinned} pagination paginationPageSize={50} paginationPageSizeSelector={[50, 100, 200]}
            onGridReady={e => { api.current = e.api; }} onFilterChanged={refresh} overlayNoRowsTemplate="No orders yet." />
        </div>
      </section>
      <section className="deed" aria-labelledby="blocked-title">
        <h2 id="blocked-title" className="h-sub">Refused by the guard</h2>
        <p className="muted">{data.blocked.length} proposals never reached PayPal. No order, no charge, no dispute to answer.</p>
        <div className="grid-wrap" style={{ height: 420 }}>
          <AgGridReact<OverviewBlocked> theme={gridTheme} rowData={data.blocked} columnDefs={blockedColumns} defaultColDef={{ ...defaults, floatingFilter: true }}
            pagination paginationPageSize={50} paginationPageSizeSelector={[50, 100, 200]} overlayNoRowsTemplate="Nothing refused yet." />
        </div>
      </section>
    </>
  );
}
