'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import MetricCard from './MetricCard';

const Chart = dynamic(() => import('./Chart'), { ssr: false });

const ranges = ['1D', '1W', '1M', '6M', '1Y'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [range, setRange] = useState('6M');
  const [dataSource, setDataSource] = useState('unknown');

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/dashboard/metrics');
      if (!response.ok) throw new Error('Failed to load dashboard');
      setDataSource(response.headers.get('x-data-source') || 'unknown');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
    } catch (error) {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">
          We ran into an issue loading your dashboard. Please try refreshing.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data?.metrics || Array.from({ length: 4 })).map((metric, idx) =>
          metric ? (
            <MetricCard key={metric.label} {...metric} />
          ) : (
            <div key={`metric-${idx}`} className="card h-28 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          )
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Performance</h2>
            <span className="muted text-xs">Updated just now</span>
          </div>
          <div className="mt-4">
            {status === 'loading' ? (
              <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
            ) : (
              <Chart data={filteredPerformance} />
            )}
          </div>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <div className="mt-4 flex flex-col gap-3">
            {(data?.recentActivity || []).length === 0 && status !== 'loading' && (
              <p className="muted text-sm">No recent activity yet.</p>
            )}
            {(data?.recentActivity || Array.from({ length: 4 })).map((item, idx) =>
              item ? (
                <div
                  key={`${item.symbol}-${idx}`}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"
                >
                  <div>
                    <p className="font-medium">{item.symbol}</p>
                    <p className="muted text-xs">
                      {item.action} · {item.time}
                    </p>
                  </div>
                  <span className={item.pnl.startsWith('-') ? 'text-rose-500' : 'text-emerald-500'}>
                    {item.pnl}
                  </span>
                </div>
              ) : (
                <div key={`activity-${idx}`} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
