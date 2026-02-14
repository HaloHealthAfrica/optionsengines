'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';

function formatNotional(value) {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function MarketTideChart({ symbol }) {
  const [tideData, setTideData] = useState(null);
  const [topImpact, setTopImpact] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([
      fetch(`/api/flow/${symbol}/market-tide`, { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/flow/top-net-impact', { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([tide, impact]) => {
        if (!cancelled) {
          setTideData(tide);
          setTopImpact(impact);
          setStatus('success');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [symbol]);

  if (status === 'loading') {
    return (
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Market Tide</h2>
          <div className="mt-4 h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Top Net Impact</h2>
          <div className="mt-4 h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card p-6 text-rose-500">
        Failed to load Market Tide data. Check Unusual Whales connection.
      </div>
    );
  }

  const chartData = (tideData?.timeSeries ?? []).map((t) => ({
    time: t.time ? new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
    callPremium: t.callPremium ?? 0,
    putPremium: t.putPremium ?? 0,
    netPremium: (t.callPremium ?? 0) - (t.putPremium ?? 0),
    volume: t.volume ?? 0,
  }));

  const maxAbs = Math.max(
    1,
    ...chartData.flatMap((d) => [Math.abs(d.callPremium ?? 0), Math.abs(d.putPremium ?? 0)])
  ) * 1.2;

  const barData = (topImpact?.tickers ?? []).slice(0, 12);
  const barMax = Math.max(1, ...barData.map((b) => Math.abs(b.netPremium ?? 0))) * 1.25;

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
      <div className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Market Tide</h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-600 dark:text-slate-400">
              {symbol}: {tideData?.currentPrice != null ? `$${Number(tideData.currentPrice).toFixed(2)}` : '--'}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              NCP: {tideData?.summary?.formatted?.ncp ?? '--'}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              NPP: {tideData?.summary?.formatted?.npp ?? '--'}
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              Vol: {tideData?.summary?.formatted?.net ?? '--'}
            </span>
          </div>
        </div>
        <p className="muted mt-1 text-xs">
          Powered by {tideData?.source === 'marketdata' ? 'MarketData.app (fallback)' : 'unusualwhales.com'}
        </p>
        <div className="mt-4 h-72">
          {chartData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 dark:bg-slate-900/40">
              <p className="muted text-sm">No intraday flow data for {symbol}</p>
              <p className="muted text-xs">Unusual Whales returned empty; MarketData.app fallback had no flow.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="time" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                <YAxis
                  yAxisId="premium"
                  domain={[-maxAbs, maxAbs]}
                  tickFormatter={(v) => formatNotional(v)}
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value) => [formatNotional(value), '']}
                  labelFormatter={(label) => `Time: ${label}`}
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    borderRadius: '8px',
                    border: '1px solid rgba(148,163,184,0.2)',
                  }}
                />
                <ReferenceLine yAxisId="premium" y={0} stroke="#64748b" strokeDasharray="3 3" />
                <Line
                  yAxisId="premium"
                  type="monotone"
                  dataKey="putPremium"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  name="Put"
                />
                <Line
                  yAxisId="premium"
                  type="monotone"
                  dataKey="callPremium"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  name="Call"
                />
                <Area
                  yAxisId="premium"
                  type="monotone"
                  dataKey="volume"
                  fill="#ef4444"
                  fillOpacity={0.15}
                  stroke="none"
                />
                <Legend />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold">Top Net Impact Chart</h2>
        <p className="muted mt-1 text-xs">Net Premiums by ticker</p>
        <div className="mt-4 h-72">
          {barData.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900/40">
              <p className="muted text-sm">No data</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={barData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis
                  type="number"
                  domain={[-barMax, barMax]}
                  tickFormatter={(v) => formatNotional(v)}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                />
                <YAxis type="category" dataKey="symbol" width={40} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => [formatNotional(value), 'Net Premium']}
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    borderRadius: '8px',
                    border: '1px solid rgba(148,163,184,0.2)',
                  }}
                />
                <ReferenceLine x={0} stroke="#64748b" strokeDasharray="3 3" />
                <Bar dataKey="netPremium" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}>
                  {barData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.netPremium >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
