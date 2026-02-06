'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import MetricCard from './MetricCard';

const WinLossChart = dynamic(() => import('./WinLossChart'), { ssr: false });

export default function History() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [dataSource, setDataSource] = useState('unknown');

  useEffect(() => {
    const loadData = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/history/stats');
        if (!response.ok) throw new Error('Failed');
        setDataSource(response.headers.get('x-data-source') || 'unknown');
        const payload = await response.json();
        setData(payload);
        setStatus('success');
      } catch (error) {
        setStatus('error');
      }
    };
    loadData();
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">History & Analytics</h1>
        <p className="muted text-sm">Performance analytics and experiment tracking.</p>
        <p className="muted text-xs">Data source: {dataSource}</p>
      </div>

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">Unable to load analytics.</div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data?.stats
          ? [
              { label: 'Total P&L', value: data.stats.totalPnl, delta: '+4.2%', trend: 'up' },
              { label: 'Win Rate', value: data.stats.winRate, delta: '+1.1%', trend: 'up' },
              { label: 'Profit Factor', value: data.stats.profitFactor, delta: '+0.2%', trend: 'up' },
              { label: 'Avg Hold', value: data.stats.avgHold, delta: '-0.1d', trend: 'down' },
            ]
          : Array.from({ length: 4 })
        ).map((item, idx) =>
          item ? (
            <MetricCard key={item.label} {...item} />
          ) : (
            <div key={`metric-${idx}`} className="card h-28 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          )
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trade History Timeline</h2>
            <button
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"
              onClick={() => {
                if (!data?.timeline) return;
                const header = 'symbol,type,date,pnl,value';
                const rows = data.timeline
                  .map((item) => `${item.symbol},${item.type},${item.date},${item.pnl},${item.value}`)
                  .join('\n');
                const blob = new Blob([`${header}\n${rows}`], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'trade-history.csv';
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {(data?.timeline || []).map((trade) => (
              <div
                key={`${trade.symbol}-${trade.date}`}
                className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/10 text-sm font-semibold text-brand-600">
                    {trade.symbol.slice(0, 1)}
                  </span>
                  <div>
                  <p className="font-medium">{trade.symbol} · {trade.type}</p>
                  <p className="muted text-xs">
                    {trade.date ? new Date(trade.date).toLocaleDateString() : '--'}
                  </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={trade.pnl.startsWith('-') ? 'text-rose-500' : 'text-emerald-500'}>{trade.pnl}</p>
                  <p className="muted text-xs">{trade.value}</p>
                </div>
              </div>
            ))}
            {status === 'loading' && (
              <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
            )}
          </div>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Win / Loss Mix</h2>
          <div className="mt-4 h-64">
            {data?.distribution ? (
              <WinLossChart data={data.distribution} />
            ) : (
              <div className="h-full animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
