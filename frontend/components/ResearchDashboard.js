'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

function fmt(n, decimals = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return Number(n).toFixed(decimals);
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function fmtDollar(n) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  const sign = v >= 0 ? '' : '-';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SeverityBadge({ severity }) {
  const s = String(severity).toUpperCase();
  const cls = s === 'CRITICAL'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <AlertTriangle size={10} />
      {s}
    </span>
  );
}

function StatBox({ label, value, sub, trend }) {
  const trendColor = trend === 'up'
    ? 'text-emerald-600 dark:text-emerald-400'
    : trend === 'down'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-slate-500 dark:text-slate-400';
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/30 bg-white/60 p-4 dark:border-slate-700/40 dark:bg-slate-800/50">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-bold ${trendColor}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}

function RollupCard({ rollup, onExpand, expanded }) {
  const winRate = Number(rollup.winRate);
  const sharpe = Number(rollup.sharpe);
  const winTrend = winRate >= 0.5 ? 'up' : winRate < 0.4 ? 'down' : 'neutral';
  const sharpeTrend = sharpe >= 1 ? 'up' : sharpe < 0 ? 'down' : 'neutral';

  return (
    <div className="card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-glass">
      <button
        type="button"
        className="flex w-full items-center justify-between p-5 text-left"
        onClick={() => onExpand(rollup.strategyTag)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500 text-white">
            <BarChart3 size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{rollup.strategyTag}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {rollup.sampleCount} trades &middot; {rollup.period}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{fmtDollar(rollup.totalPnl)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Total P&L</p>
          </div>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200/60 bg-slate-50/50 px-5 pb-5 pt-4 dark:border-slate-700/40 dark:bg-slate-900/30">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="Win Rate" value={fmtPct(rollup.winRate)} trend={winTrend} />
            <StatBox label="Sharpe" value={fmt(sharpe)} trend={sharpeTrend} />
            <StatBox label="Profit Factor" value={fmt(rollup.profitFactor)} />
            <StatBox label="Avg P&L" value={fmtDollar(rollup.avgPnl)} trend={Number(rollup.avgPnl) >= 0 ? 'up' : 'down'} />
            <StatBox label="Max Drawdown" value={fmtDollar(rollup.maxDrawdown)} sub={fmtPct(rollup.maxDrawdownPct)} trend="down" />
            <StatBox label="Avg R-Multiple" value={fmt(rollup.avgRMultiple, 3)} />
            <StatBox label="Avg Slippage" value={fmtDollar(rollup.avgSlippage)} />
            <StatBox label="Avg Hold Days" value={fmt(rollup.avgHoldingDays, 1)} />
          </div>

          {rollup.byRegime && Object.keys(rollup.byRegime).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">By Regime</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(rollup.byRegime).map(([regime, data]) => (
                  <div key={regime} className="rounded-xl border border-slate-200/40 bg-white/50 p-3 dark:border-slate-700/30 dark:bg-slate-800/40">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{regime}</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{fmtPct(data.winRate)} WR</p>
                    <p className="text-xs text-slate-400">{data.count} trades &middot; {fmtDollar(data.totalPnl)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rollup.byDteBucket && Object.keys(rollup.byDteBucket).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">By DTE Bucket</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Object.entries(rollup.byDteBucket).map(([bucket, data]) => (
                  <div key={bucket} className="rounded-xl border border-slate-200/40 bg-white/50 p-3 dark:border-slate-700/30 dark:bg-slate-800/40">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{bucket} DTE</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{fmtPct(data.winRate)}</p>
                    <p className="text-xs text-slate-400">{data.count} trades</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rollup.byHour && Object.keys(rollup.byHour).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">By Hour</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Object.entries(rollup.byHour)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([hour, data]) => (
                    <div key={hour} className="rounded-xl border border-slate-200/40 bg-white/50 p-2 text-center dark:border-slate-700/30 dark:bg-slate-800/40">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{hour}</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{fmtPct(data.winRate)}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DriftCard({ drift, onResolve, resolving }) {
  return (
    <div className="card flex items-center justify-between p-4 transition hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
          <TrendingDown size={16} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{drift.strategyTag}</p>
            <SeverityBadge severity={drift.severity} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {drift.driftType} &middot; baseline {fmt(drift.baselineValue, 3)} &rarr; current {fmt(drift.currentValue, 3)}
            &nbsp;(delta {fmt(drift.delta, 3)}, threshold {fmt(drift.threshold, 3)})
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Window {drift.rollingWindow}/{drift.baselineWindow} &middot; {new Date(drift.detectedAt).toLocaleString()}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={resolving}
        onClick={() => onResolve(drift.id)}
        className="flex items-center gap-1 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30"
      >
        <CheckCircle2 size={12} />
        Resolve
      </button>
    </div>
  );
}

function ContextSection({ strategyTag, breakdowns }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
            <FlaskConical size={16} />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{strategyTag}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {breakdowns.length} context types
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200/60 px-4 pb-4 pt-3 dark:border-slate-700/40">
          {breakdowns.map((breakdown, i) => (
            <div key={i} className="mb-3 last:mb-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {breakdown.contextType.replace(/_/g, ' ')}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(breakdown.segments || []).map((seg, j) => {
                  const wr = Number(seg.winRate);
                  const wrColor = wr >= 0.55
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : wr < 0.4
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-700 dark:text-slate-200';
                  return (
                    <div key={j} className="rounded-xl border border-slate-200/40 bg-white/50 p-3 dark:border-slate-700/30 dark:bg-slate-800/40">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{seg.contextValue}</p>
                      <p className={`text-sm font-bold ${wrColor}`}>{fmtPct(seg.winRate)} WR</p>
                      <p className="text-xs text-slate-400">
                        {seg.sampleCount} trades &middot; {fmtDollar(seg.totalPnl)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Sharpe {fmt(seg.sharpe)} &middot; Slip {fmtDollar(seg.avgSlippage)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResearchDashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [expandedRollup, setExpandedRollup] = useState(null);
  const [resolvingDrift, setResolvingDrift] = useState(null);

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/research/overview');
      if (!response.ok) throw new Error('Failed to load');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleResolve = async (driftId) => {
    setResolvingDrift(driftId);
    try {
      await fetch('/api/research/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driftId }),
      });
      await loadData();
    } catch {
      // silently fail
    } finally {
      setResolvingDrift(null);
    }
  };

  const rollups = data?.rollups ?? [];
  const drifts = data?.drifts ?? [];
  const context = data?.context ?? {};

  const totalStrategies = rollups.length;
  const avgWinRate = totalStrategies > 0
    ? rollups.reduce((s, r) => s + Number(r.winRate), 0) / totalStrategies
    : 0;
  const totalPnl = rollups.reduce((s, r) => s + Number(r.totalPnl), 0);
  const avgSharpe = totalStrategies > 0
    ? rollups.reduce((s, r) => s + Number(r.sharpe), 0) / totalStrategies
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Research Dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Strategy intelligence &middot; Performance rollups &middot; Drift detection &middot; Context analysis
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={status === 'loading'}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          <RefreshCcw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
          {status === 'loading' ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {status === 'error' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load research data. The backend may be unavailable or no trading data exists yet.
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Strategies" value={totalStrategies} sub="tracked" />
        <StatBox label="Avg Win Rate" value={fmtPct(avgWinRate)} trend={avgWinRate >= 0.5 ? 'up' : 'down'} />
        <StatBox label="Total P&L" value={fmtDollar(totalPnl)} trend={totalPnl >= 0 ? 'up' : 'down'} />
        <StatBox label="Avg Sharpe" value={fmt(avgSharpe)} trend={avgSharpe >= 1 ? 'up' : avgSharpe < 0 ? 'down' : 'neutral'} />
      </div>

      {/* Drift Alerts */}
      {drifts.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Active Drift Alerts ({drifts.length})
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {drifts.map((drift) => (
              <DriftCard
                key={drift.id}
                drift={drift}
                onResolve={handleResolve}
                resolving={resolvingDrift === drift.id}
              />
            ))}
          </div>
        </div>
      )}

      {drifts.length === 0 && status === 'success' && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 size={16} />
          No active drift alerts. All strategies performing within baseline thresholds.
        </div>
      )}

      {/* Strategy Rollups */}
      {rollups.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Strategy Performance Rollups
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {rollups.map((rollup) => (
              <RollupCard
                key={rollup.strategyTag}
                rollup={rollup}
                expanded={expandedRollup === rollup.strategyTag}
                onExpand={(tag) => setExpandedRollup(expandedRollup === tag ? null : tag)}
              />
            ))}
          </div>
        </div>
      )}

      {rollups.length === 0 && status === 'success' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <Activity size={32} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No strategy rollups yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Rollups will appear once trades are executed and attribution data is available.
          </p>
        </div>
      )}

      {/* Context Performance */}
      {Object.keys(context).length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical size={16} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Context Performance
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              &mdash; Performance by IV regime, term structure, liquidity
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {Object.entries(context).map(([tag, breakdowns]) => (
              <ContextSection key={tag} strategyTag={tag} breakdowns={breakdowns} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
