'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import MetricCard from './MetricCard';
import DataSourceBanner from './DataSourceBanner';
import DataFreshnessIndicator from './DataFreshnessIndicator';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const Chart = dynamic(() => import('./Chart'), { ssr: false });
const GammaPanel = dynamic(() => import('./GammaPanel'), { ssr: false });

const ranges = ['1D', '1W', '1M', '6M', '1Y'];

function formatPnl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  const sign = n >= 0 ? '' : '-';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleString();
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [range, setRange] = useState('6M');
  const [dataSource, setDataSource] = useState('unknown');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [detailPanel, setDetailPanel] = useState(null);

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/dashboard/metrics');
      if (!response.ok) throw new Error('Failed to load dashboard');
      setDataSource(response.headers.get('x-data-source') || 'unknown');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
      setLastUpdated(Date.now());
    } catch (error) {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useAutoRefresh(loadData, 30000, true);

  const filteredPerformance = useMemo(() => {
    if (!data?.performance) return [];
    if (range === '1D') return data.performance.slice(-1);
    if (range === '1W') return data.performance.slice(-2);
    if (range === '1M') return data.performance.slice(-3);
    if (range === '1Y') return data.performance;
    return data.performance;
  }, [data, range]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio Overview</h1>
          <p className="muted text-sm">Live portfolio metrics and signal activity.</p>
          <p className="muted text-xs">Data source: {dataSource}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Performance ranges">
            {ranges.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={`tab-button ${item === range ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
                aria-pressed={item === range}
                role="tab"
              >
                {item}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadData}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
            aria-label="Refresh dashboard"
          >
            <RefreshCcw size={16} className={status === 'loading' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <DataSourceBanner source={dataSource} />
      <DataFreshnessIndicator lastUpdated={lastUpdated} />

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">
          We ran into an issue loading your dashboard. Please try refreshing.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data?.metrics || Array.from({ length: 4 })).map((metric, idx) =>
          metric ? (
            <MetricCard
              key={metric.label}
              {...metric}
              cardId={metric.id}
              onClick={(id) => setDetailPanel({ type: id })}
            />
          ) : (
            <div key={`metric-${idx}`} className="card h-28 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          )
        )}
      </div>

      <GammaPanel defaultSymbol="SPY" />

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <button
          type="button"
          className="card p-6 text-left transition hover:shadow-glass"
          onClick={() => setDetailPanel({ type: 'performance' })}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Performance</h2>
            <span className="muted text-xs">Updated just now · Click for details</span>
          </div>
          <div className="mt-4">
            {status === 'loading' ? (
              <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
            ) : (
              <Chart data={filteredPerformance} />
            )}
          </div>
        </button>
        <div className="card p-6">
          <button
            type="button"
            className="mb-4 block w-full text-left"
            onClick={() => setDetailPanel({ type: 'recent-activity' })}
          >
            <h2 className="text-lg font-semibold">Recent Activity</h2>
            <p className="muted text-xs">Click for full list</p>
          </button>
          <div className="mt-4 flex flex-col gap-3">
            {(data?.recentActivity || []).length === 0 && status !== 'loading' && (
              <p className="muted text-sm">No recent activity yet.</p>
            )}
            {(data?.recentActivity || Array.from({ length: 4 })).map((item, idx) =>
              item ? (
                <button
                  key={`${item.symbol ?? 'n'}-${idx}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-left text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  onClick={() => setDetailPanel({ type: 'position-detail', item: item.position ?? item })}
                >
                  <div>
                    <p className="font-medium">{item.symbol ?? '--'}</p>
                    <p className="muted text-xs">
                      {item.action ?? '--'} · {item.time ?? '--'}
                    </p>
                  </div>
                  <span className={item.pnl != null && String(item.pnl).startsWith('-') ? 'text-rose-500' : 'text-emerald-500'}>
                    {item.pnl ?? '--'}
                  </span>
                </button>
              ) : (
                <div key={`activity-${idx}`} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
              )
            )}
          </div>
        </div>
      </div>

      {detailPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="card max-h-[90vh] w-full max-w-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold">
                {detailPanel.type === 'total-pnl' && 'Total P&L Breakdown'}
                {detailPanel.type === 'win-rate' && 'Win Rate by Source'}
                {detailPanel.type === 'active-positions' && 'Active Positions'}
                {detailPanel.type === 'profit-factor' && 'Profit Factor'}
                {detailPanel.type === 'performance' && 'P&L Curve'}
                {detailPanel.type === 'recent-activity' && 'Recent Activity'}
                {detailPanel.type === 'position-detail' && 'Position Details'}
              </h2>
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-slate-700"
                onClick={() => setDetailPanel(null)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-4">
              {detailPanel.type === 'total-pnl' && (
                <div className="space-y-4">
                  <p className="muted text-sm">Cumulative P&L over time (last 30 days).</p>
                  {(data?.pnl_curve || []).length === 0 ? (
                    <p className="muted text-sm">No P&L data yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.pnl_curve.slice(-14).map((p, i) => (
                        <div key={i} className="flex justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                          <span className="text-sm">{p.date ? new Date(p.date).toLocaleDateString() : '--'}</span>
                          <span className={Number(p.value ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {formatPnl(p.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detailPanel.type === 'win-rate' && (
                <div className="space-y-4">
                  <p className="muted text-sm">Signal acceptance rate by source.</p>
                  {(data?.source_performance || []).length === 0 ? (
                    <p className="muted text-sm">No source data yet.</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="pb-2 text-left font-medium">Source</th>
                          <th className="pb-2 text-right font-medium">Acceptance Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.source_performance.map((s, i) => (
                          <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-2">{s.source ?? '--'}</td>
                            <td className="py-2 text-right">{s.acceptance_rate ?? 0}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {detailPanel.type === 'active-positions' && (
                <div className="space-y-4">
                  <p className="muted text-sm">All open positions. Click a row to drill down.</p>
                  {(data?.positions || []).length === 0 ? (
                    <p className="muted text-sm">No active positions.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.positions.map((p) => (
                        <button
                          key={p.position_id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                          onClick={() => setDetailPanel({ type: 'position-detail', item: p })}
                        >
                          <span className="font-medium">{p.symbol ?? '--'}</span>
                          <span className="text-xs text-slate-500">
                            {p.type ?? '--'} · ${p.strike ?? '--'} · {p.expiration ? new Date(p.expiration).toLocaleDateString() : '--'}
                          </span>
                          <span className={Number(p.position_pnl_percent ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {p.position_pnl_percent != null ? `${Number(p.position_pnl_percent).toFixed(1)}%` : '--'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detailPanel.type === 'profit-factor' && (
                <p className="muted text-sm">Profit factor data coming soon. This metric requires closed trade analysis.</p>
              )}
              {detailPanel.type === 'performance' && (
                <div className="space-y-4">
                  <p className="muted text-sm">Cumulative P&L by period.</p>
                  {(data?.pnl_curve || []).length === 0 ? (
                    <p className="muted text-sm">No performance data yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.pnl_curve.map((p, i) => (
                        <div key={i} className="flex justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                          <span className="text-sm">{p.date ? new Date(p.date).toLocaleDateString() : '--'}</span>
                          <span className={Number(p.value ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {formatPnl(p.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detailPanel.type === 'recent-activity' && (
                <div className="space-y-2">
                  {(data?.positions || []).length === 0 ? (
                    <p className="muted text-sm">No recent activity.</p>
                  ) : (
                    data.positions.slice(0, 20).map((p) => (
                      <button
                        key={p.position_id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                        onClick={() => setDetailPanel({ type: 'position-detail', item: p })}
                      >
                        <div>
                          <span className="font-medium">{p.symbol ?? '--'}</span>
                          <span className="muted ml-2 text-xs">
                            Opened {p.entry_timestamp ? new Date(p.entry_timestamp).toLocaleString() : '--'}
                          </span>
                        </div>
                        <span className={Number(p.position_pnl_percent ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {p.position_pnl_percent != null ? `${Number(p.position_pnl_percent).toFixed(1)}%` : '--'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {detailPanel.type === 'position-detail' && detailPanel.item && (
                <div className="grid gap-3 text-sm">
                  <div className="flex justify-between"><span className="muted">Symbol</span><span>{detailPanel.item.symbol ?? '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Type</span><span>{detailPanel.item.type ?? '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Strike</span><span>${detailPanel.item.strike ?? '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Expiration</span><span>{detailPanel.item.expiration ? formatDate(detailPanel.item.expiration) : '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Quantity</span><span>{detailPanel.item.quantity ?? '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Entry Price</span><span>{detailPanel.item.entry_price != null ? `$${Number(detailPanel.item.entry_price).toFixed(2)}` : '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Current Price</span><span>{detailPanel.item.current_price != null ? `$${Number(detailPanel.item.current_price).toFixed(2)}` : '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">P&L %</span><span className={Number(detailPanel.item.position_pnl_percent ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{detailPanel.item.position_pnl_percent != null ? `${Number(detailPanel.item.position_pnl_percent).toFixed(1)}%` : '--'}</span></div>
                  <div className="flex justify-between"><span className="muted">Entry Time</span><span>{detailPanel.item.entry_timestamp ? formatDate(detailPanel.item.entry_timestamp) : '--'}</span></div>
                  {detailPanel.item.engine && <div className="flex justify-between"><span className="muted">Engine</span><span>Engine {detailPanel.item.engine}</span></div>}
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
              <button
                type="button"
                className="gradient-button w-full rounded-full px-4 py-2 text-sm font-semibold"
                onClick={() => setDetailPanel(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
