'use client';
import { useMemo, useState } from 'react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import type { SessionState } from '@/lib/state';
import { describeEntry, money, short } from './format';

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid in Mandat's own type and security-paper palette (the values are the site's CSS tokens). */
export const gridTheme = themeQuartz.withParams({
  fontFamily: 'var(--font-body)',
  headerFontFamily: 'var(--font-body)',
  fontSize: 14,
  headerFontSize: 12,
  headerFontWeight: 700,
  backgroundColor: 'var(--paper)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  headerBackgroundColor: 'var(--paper-sunk)',
  headerTextColor: 'var(--ink-soft)',
  borderColor: 'var(--rule)',
  rowHoverColor: 'var(--paper-sunk)',
  accentColor: 'var(--seal)',
  oddRowBackgroundColor: 'transparent',
  wrapperBorderRadius: 3,
  borderRadius: 3,
  spacing: 7,
});

const Verdict = ({ kind, label }: { kind: string; label: string }) => <span className={`verdict verdict-${kind}`}>{label}</span>;

type Order = SessionState['orders'][number];
interface OrderRow {
  item: string; amount: string; minor: number; paidBy: string; guard: string;
  orderId: string; customId: string; tracking: string; dispute?: string; mode: Order['mode'];
}

/** Merchant back office: every paid order, how it was authorized, and its dispute state. */
export function OrdersGrid({ s, busy, onChargeback }: { s: SessionState; busy: string; onChargeback: (orderId: string) => void }) {
  const rows = useMemo<OrderRow[]>(() => s.orders.filter(o => o.state === 'paid').map(o => {
    const t = s.ledger.find(e => e.type === 'shipment.tracked' && (e.data as any).orderId === o.orderId)?.data as any;
    const d = s.disputes.find(x => x.orderId === o.orderId);
    return {
      item: `${o.proposal.title} ×${o.proposal.quantity}`, amount: money(o.amount), minor: o.amount.minor,
      paidBy: o.mode === 'direct' ? 'Card' : 'PayPal account', guard: o.mode === 'direct' ? 'Allowed' : 'Approved by buyer',
      orderId: o.orderId, customId: short(s.mandateHash, 12), tracking: t ? `${t.carrier} ${t.trackingNumber}` : '—',
      dispute: d ? (d.simulatedOutcome ? 'Won (simulated)' : d.response ? 'Evidence sent' : 'Open') : undefined, mode: o.mode,
    };
  }), [s]);

  const columns = useMemo<ColDef<OrderRow>[]>(() => [
    { field: 'item', headerName: 'Item', flex: 1, minWidth: 170, wrapText: true },
    { field: 'amount', headerName: 'Amount', width: 104, comparator: (_a, _b, x, y) => (x.data?.minor ?? 0) - (y.data?.minor ?? 0), cellClass: 'num' },
    {
      field: 'guard', headerName: 'Authorized by', width: 190,
      cellRenderer: (p: ICellRendererParams<OrderRow>) => <span className="cell-stack"><Verdict kind={p.data?.mode === 'direct' ? 'allow' : 'pending'} label={p.value} /><span className="faint">{p.data?.paidBy}</span></span>,
    },
    {
      field: 'orderId', headerName: 'PayPal order · custom_id', width: 210,
      cellRenderer: (p: ICellRendererParams<OrderRow>) => <span className="cell-stack"><code>{p.value}</code><code className="faint">{p.data?.customId}</code></span>,
    },
    { field: 'tracking', headerName: 'Tracking', width: 170, wrapText: true },
    {
      field: 'dispute', headerName: 'Dispute', width: 196, sortable: false,
      cellRenderer: (p: ICellRendererParams<OrderRow>) => {
        if (p.value) return <Verdict kind={p.value.startsWith('Won') ? 'allow' : 'pending'} label={p.value} />;
        if (p.data?.mode !== 'direct') return <span className="faint">No chargeback (PayPal account)</span>;
        if (!s.live) return <span className="faint">—</span>;
        return <button className="btn btn-quiet btn-cell" aria-disabled={Boolean(busy)} onClick={() => { if (!busy && p.data) onChargeback(p.data.orderId); }}>{busy === p.data?.orderId ? 'Opening…' : 'Simulate a chargeback'}</button>;
      },
    },
  ], [s.live, busy, onChargeback]);

  return (
    <div className="grid-wrap">
      <AgGridReact<OrderRow> theme={gridTheme} rowData={rows} columnDefs={columns} domLayout="autoHeight" getRowId={p => p.data.orderId}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }} rowHeight={64}
        overlayNoRowsTemplate="No paid orders yet." />
    </div>
  );
}

interface LedgerRow { seq: number; event: string; detail: string; verdict?: [string, string]; hash: string }

/** The sealed ledger as an auditable table: sort, filter, search every entry and its hash. */
export function LedgerGrid({ s }: { s: SessionState }) {
  const [q, setQ] = useState('');
  const rows = useMemo<LedgerRow[]>(() => s.ledger.map(e => {
    const d = describeEntry(e.type, e.data);
    return { seq: e.seq, event: d.label, detail: d.detail ?? '', verdict: d.verdict as [string, string] | undefined, hash: e.hash };
  }), [s.ledger]);
  const columns = useMemo<ColDef<LedgerRow>[]>(() => [
    { field: 'seq', headerName: '#', width: 60 },
    { field: 'event', headerName: 'Entry', flex: 2, minWidth: 150, wrapText: true, autoHeight: true },
    { field: 'verdict', headerName: 'Verdict', width: 112, valueGetter: p => p.data?.verdict?.[1] ?? '', cellRenderer: (p: ICellRendererParams<LedgerRow>) => p.data?.verdict ? <Verdict kind={p.data.verdict[0]} label={p.data.verdict[1]} /> : null },
    { field: 'detail', headerName: 'Detail', flex: 3, minWidth: 170, wrapText: true, autoHeight: true, cellClass: 'faint-cell' },
    { field: 'hash', headerName: 'Entry hash', width: 140, valueFormatter: p => short(p.value, 12), cellClass: 'mono-cell' },
  ], []);
  return (
    <div className="stack">
      <label className="grid-search">Search the ledger
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. blocked, PayPal order id, hash" />
      </label>
      <div className="grid-wrap">
        <AgGridReact<LedgerRow> theme={gridTheme} rowData={rows} columnDefs={columns} domLayout="autoHeight" quickFilterText={q}
          getRowId={p => String(p.data.seq)} defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }} />
      </div>
    </div>
  );
}
