'use client';

import { useMemo, useState, useEffect } from 'react';
import { Filter, SlidersHorizontal } from 'lucide-react';

const tabs = [
  { id: 'active', label: 'Active Orders' },
  { id: 'filled', label: 'Filled Trades' },
  { id: 'closed', label: 'Closed P&L' },
];

const statusColors = {
  filled: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
};

export default function Orders() {
  const [activeTab, setActiveTab] = useState('active');
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('idle');
  const [sortKey, setSortKey] = useState('time');
  const [filter, setFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [dataSource, setDataSource] = useState('unknown');

  useEffect(() => {
    const loadOrders = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/orders');
        if (!response.ok) throw new Error('Failed');
        setDataSource(response.headers.get('x-data-source') || 'unknown');
        const payload = await response.json();
        setOrders(payload.orders || []);
        setStatus('success');
      } catch (error) {
        setStatus('error');
      }
    };
    loadOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    const scoped = orders.filter((order) => {
      if (activeTab === 'active') return order.status === 'pending';
      if (activeTab === 'filled') return order.status === 'filled';
      return order.status === 'cancelled';
    });

    const filtered =
      filter === 'all' ? scoped : scoped.filter((order) => order.type.toLowerCase() === filter);

    return filtered.sort((a, b) => {
      if (sortKey === 'price') return Number(b.price || 0) - Number(a.price || 0);
      if (sortKey === 'qty') return b.qty - a.qty;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
  }, [orders, activeTab, filter, sortKey]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="muted text-sm">Execution tracking and trade history.</p>
          <p className="muted text-xs">Data source: {dataSource}</p>
        </div>
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
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Strike</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`loading-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-4" colSpan={8}>
                      <div className="h-6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/40" />
                    </td>
                  </tr>
                ))}
              {status !== 'loading' && filteredOrders.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={8}>
                    No orders found for this filter.
                  </td>
                </tr>
              )}
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  onClick={() => setSelectedOrder(order)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setSelectedOrder(order);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                >
                  <td className="px-4 py-4 font-medium">{order.symbol}</td>
                  <td className="px-4 py-4">{order.type}</td>
                  <td className="px-4 py-4">{order.strike}</td>
                  <td className="px-4 py-4">{order.expiry}</td>
                  <td className="px-4 py-4">{order.qty}</td>
                  <td className="px-4 py-4">
                    {order.price !== null && order.price !== undefined ? `$${Number(order.price).toFixed(2)}` : '--'}
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusColors[order.status]}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {order.time ? new Date(order.time).toLocaleString() : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
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
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="muted">Symbol</span>
                <span>{selectedOrder.symbol}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Type</span>
                <span>{selectedOrder.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Strike</span>
                <span>{selectedOrder.strike}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Expiry</span>
                <span>{selectedOrder.expiry}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Quantity</span>
                <span>{selectedOrder.qty}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Status</span>
                <span className="capitalize">{selectedOrder.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">P&L</span>
                <span>{selectedOrder.pnl}</span>
              </div>
            </div>
            <button
              type="button"
              className="gradient-button mt-6 w-full rounded-full px-4 py-2 text-sm font-semibold"
              onClick={() => setSelectedOrder(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
