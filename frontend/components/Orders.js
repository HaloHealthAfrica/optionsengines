'use client';

import { useMemo, useState, useEffect } from 'react';
import { Filter, SlidersHorizontal } from 'lucide-react';
import { useRealtime } from '../hooks/useRealtime';

const tabs = [
  { id: 'active', label: 'Active Orders' },
  { id: 'filled', label: 'Filled Trades' },
  { id: 'closed', label: 'Closed P&L' },
];

const statusColors = {
  filled: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
  closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

export default function Orders() {
  const [activeTab, setActiveTab] = useState('active');
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);
  const [status, setStatus] = useState('idle');
  const [sortKey, setSortKey] = useState('time');
  const [filter, setFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [dataSource, setDataSource] = useState('unknown');
  const { positions: livePositions, riskState } = useRealtime();

  useEffect(() => {
    const loadOrders = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/orders');
        if (!response.ok) throw new Error('Failed');
        setDataSource(response.headers.get('x-data-source') || 'unknown');
        const payload = await response.json();
        setOrders(payload.orders || []);
        setTrades(payload.trades || []);
        setPositions(payload.positions || []);
        setStatus('success');
      } catch (error) {
        setStatus('error');
      }
    };
    loadOrders();
  }, []);

  useEffect(() => {
    if (Array.isArray(livePositions)) {
      setPositions(livePositions);
    }
  }, [livePositions]);

  const rows = useMemo(() => {
    const source = activeTab === 'active' ? orders : activeTab === 'filled' ? trades : positions;
    const filtered =
      filter === 'all'
        ? source
        : source.filter((item) => String(item.type || '').toLowerCase() === filter);

    return filtered.sort((a, b) => {
      if (sortKey === 'price') return Number(b.price || b.entry_price || 0) - Number(a.price || a.entry_price || 0);
      if (sortKey === 'qty') return Number(b.qty || 0) - Number(a.qty || 0);
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
  }, [orders, trades, positions, activeTab, filter, sortKey]);

  const columns =
    activeTab === 'closed'
      ? ['Symbol', 'Type', 'Strike', 'Expiry', 'Qty', 'Entry', 'Realized P&L', 'Time']
      : ['Symbol', 'Type', 'Strike', 'Expiry', 'Qty', 'Price', 'Status', 'Time'];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="muted text-sm">Execution tracking and trade history.</p>
          <p className="muted text-xs">Data source: {dataSource}</p>
        </div>
        {riskState && (
          <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Risk Snapshot</p>
            <div className="mt-1 flex flex-wrap gap-3">
              <span>Open: {riskState.open_positions ?? 0}</span>
              <span>Max: {riskState.max_open_positions ?? '--'}</span>
              <span>Unrealized: {Number(riskState.unrealized_pnl ?? 0).toFixed(2)}</span>
              <span>Realized: {Number(riskState.realized_pnl ?? 0).toFixed(2)}</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/60">
            <Filter size={14} className="text-slate-400" />
            <select
              className="bg-transparent text-sm outline-none"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filter orders"
            >
              <option value="all">All</option>
              <option value="call">Calls</option>
              <option value="put">Puts</option>
            </select>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/60">
            <SlidersHorizontal size={14} className="text-slate-400" />
            <select
              className="bg-transparent text-sm outline-none"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
              aria-label="Sort orders"
            >
              <option value="time">Sort by Time</option>
              <option value="price">Sort by Price</option>
              <option value="qty">Sort by Quantity</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Orders tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`tab-button ${tab.id === activeTab ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
            aria-pressed={tab.id === activeTab}
            role="tab"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">Unable to load orders.</div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="px-4 py-3">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {status === 'loading' &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`loading-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-4" colSpan={columns.length}>
                      <div className="h-6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/40" />
                    </td>
                  </tr>
                ))}
              {status !== 'loading' && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={columns.length}>
                    No orders found for this filter.
                  </td>
                </tr>
              )}
              {rows.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  onClick={() => setSelectedItem({ item, type: activeTab })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setSelectedItem({ item, type: activeTab });
                    }
                  }}
                  tabIndex={0}
                  role="button"
                >
                  <td className="px-4 py-4 font-medium">{item.symbol}</td>
                  <td className="px-4 py-4">{item.type}</td>
                  <td className="px-4 py-4">{item.strike}</td>
                  <td className="px-4 py-4">{item.expiry}</td>
                  <td className="px-4 py-4">{item.qty}</td>
                  {activeTab === 'closed' ? (
                    <>
                      <td className="px-4 py-4">
                        {item.entry_price !== null && item.entry_price !== undefined
                          ? `$${Number(item.entry_price).toFixed(2)}`
                          : '--'}
                      </td>
                      <td className="px-4 py-4">
                        {item.realized_pnl !== null && item.realized_pnl !== undefined
                          ? `$${Number(item.realized_pnl).toFixed(2)}`
                          : '--'}
                      </td>
                      <td className="px-4 py-4">{item.time ? new Date(item.time).toLocaleString() : '--'}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-4">
                        {item.price !== null && item.price !== undefined ? `$${Number(item.price).toFixed(2)}` : '--'}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusColors[item.status]}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">{item.time ? new Date(item.time).toLocaleString() : '--'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="card w-full max-w-lg p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Order Details</h2>
              <button
                type="button"
                className="text-sm text-slate-500"
                onClick={() => setSelectedItem(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="muted">Symbol</span>
                <span>{selectedItem.item.symbol}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Type</span>
                <span>{selectedItem.item.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Strike</span>
                <span>{selectedItem.item.strike}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Expiry</span>
                <span>{selectedItem.item.expiry}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Quantity</span>
                <span>{selectedItem.item.qty}</span>
              </div>
              {selectedItem.type !== 'closed' && (
                <div className="flex items-center justify-between">
                  <span className="muted">Status</span>
                  <span className="capitalize">{selectedItem.item.status}</span>
                </div>
              )}
              {selectedItem.type === 'closed' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="muted">Entry</span>
                    <span>
                      {selectedItem.item.entry_price !== null && selectedItem.item.entry_price !== undefined
                        ? `$${Number(selectedItem.item.entry_price).toFixed(2)}`
                        : '--'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Realized P&L</span>
                    <span>
                      {selectedItem.item.realized_pnl !== null && selectedItem.item.realized_pnl !== undefined
                        ? `$${Number(selectedItem.item.realized_pnl).toFixed(2)}`
                        : '--'}
                    </span>
                  </div>
                </>
              )}
              {selectedItem.type === 'filled' && selectedItem.item.decision && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="muted">Decision</span>
                    <span className="capitalize">
                      {selectedItem.item.decision.engine} · {selectedItem.item.decision.source.replace('_', ' ')}
                    </span>
                  </div>
                  {selectedItem.item.decision.bias && (
                    <div className="flex items-center justify-between">
                      <span className="muted">Bias</span>
                      <span className="capitalize">{selectedItem.item.decision.bias}</span>
                    </div>
                  )}
                  {typeof selectedItem.item.decision.confidence === 'number' && (
                    <div className="flex items-center justify-between">
                      <span className="muted">Confidence</span>
                      <span>{selectedItem.item.decision.confidence}</span>
                    </div>
                  )}
                  {Array.isArray(selectedItem.item.decision.reasons) &&
                    selectedItem.item.decision.reasons.length > 0 && (
                      <div className="rounded-2xl border border-slate-100 bg-white/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/40">
                        <p className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Reasons</p>
                        <ul className="space-y-1">
                          {selectedItem.item.decision.reasons.slice(0, 5).map((reason, idx) => (
                            <li key={`reason-${idx}`}>{String(reason)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                </>
              )}
            </div>
            <button
              type="button"
              className="gradient-button mt-6 w-full rounded-full px-4 py-2 text-sm font-semibold"
              onClick={() => setSelectedItem(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
