'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  RefreshCcw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Zap,
  Activity,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${(n * 100).toFixed(0)}%`;
}

function formatR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(2);
}

function HeatmapCell({ wr, sampleSize, pattern, timeframe }) {
  const pct = Number(wr) || 0;
  const hasData = (sampleSize || 0) >= 3;
  let bg = 'bg-slate-100 dark:bg-slate-800/50';
  let text = 'text-slate-400';
  if (hasData) {
    if (pct >= 0.6) {
      bg = 'bg-emerald-500/30 dark:bg-emerald-500/20';
      text = 'text-emerald-700 dark:text-emerald-300';
    } else if (pct >= 0.4) {
      bg = 'bg-amber-500/30 dark:bg-amber-500/20';
      text = 'text-amber-700 dark:text-amber-300';
    } else if (pct > 0) {
      bg = 'bg-rose-500/30 dark:bg-rose-500/20';
      text = 'text-rose-700 dark:text-rose-300';
    }
  }
  return (
    <div
      className={`flex min-h-[2.5rem] min-w-[3.5rem] flex-col items-center justify-center rounded px-2 py-1 text-xs ${bg} ${text}`}
      title={`${pattern} on ${timeframe}: ${formatPct(pct)} (n=${sampleSize || 0})`}
    >
      <span className="font-semibold">{hasData ? formatPct(pct) : '—'}</span>
      <span className="text-[10px] opacity-70">n={sampleSize || 0}</span>
    </div>
  );
}

function InsightIcon({ type }) {
  if (type === 'positive') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (type === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

export default function StratIntelligencePanel({ onTune, isDemoMode }) {
  const [overview, setOverview] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [timeframes, setTimeframes] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [calibration, setCalibration] = useState([]);
  const [flow, setFlow] = useState(null);
  const [insights, setInsights] = useState([]);
  const [tuningHistory, setTuningHistory] = useState([]);
  const [heatmapMatrix, setHeatmapMatrix] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tuneLoading, setTuneLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadAll = useCallback(async () => {
    if (isDemoMode) {
      setLoading(false);
      setOverview({ totalAlerts: 0, winRate: 0, avgRR: 0, profitFactor: 0, expectancy: 0 });
      setPatterns([]);
      setCalibration([]);
      setFlow({ flowAlignmentEdge: 0, isFlowUseful: false, sampleSizes: { aligned: 0, opposing: 0 } });
      setInsights([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, patternsRes, timeframesRes, symbolsRes, calibrationRes, flowRes, insightsRes, historyRes, matrixRes] =
        await Promise.all([
          fetch('/api/strat/analytics/overview', { cache: 'no-store' }),
          fetch('/api/strat/analytics/patterns', { cache: 'no-store' }),
          fetch('/api/strat/analytics/timeframes', { cache: 'no-store' }),
          fetch('/api/strat/analytics/symbols', { cache: 'no-store' }),
          fetch('/api/strat/analytics/score-calibration', { cache: 'no-store' }),
          fetch('/api/strat/analytics/flow-alignment', { cache: 'no-store' }),
          fetch('/api/strat/analytics/insights', { cache: 'no-store' }),
          fetch('/api/strat/analytics/tuning-history', { cache: 'no-store' }),
          fetch('/api/strat/analytics/pattern-timeframe', { cache: 'no-store' }),
        ]);

      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (patternsRes.ok) setPatterns((await patternsRes.json()).patterns || []);
      if (timeframesRes.ok) setTimeframes((await timeframesRes.json()).timeframes || []);
      if (symbolsRes.ok) setSymbols((await symbolsRes.json()).symbols || []);
      if (calibrationRes.ok) setCalibration((await calibrationRes.json()).calibration || []);
      if (flowRes.ok) setFlow(await flowRes.json());
      if (insightsRes.ok) setInsights((await insightsRes.json()).insights || []);
      if (historyRes.ok) setTuningHistory((await historyRes.json()).history || []);
      if (matrixRes.ok) setHeatmapMatrix((await matrixRes.json()).matrix || []);
    } catch (err) {
      console.error('Strat intelligence load failed:', err);
      setError(err?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [isDemoMode]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleTune = async () => {
    if (isDemoMode) return;
    setTuneLoading(true);
    try {
      const res = await fetch('/api/strat/analytics/tune', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Tune failed');
      await loadAll();
      if (onTune) onTune(data);
    } catch (err) {
      setError(err?.message || 'Tuning failed');
    } finally {
      setTuneLoading(false);
    }
  };

  const getCell = (pattern, timeframe) => {
    const m = heatmapMatrix.find((x) => x.pattern === pattern && x.timeframe === timeframe);
    return m ? { wr: m.winRate, n: m.sampleSize } : { wr: 0, n: 0 };
  };
  const patternList = [...new Set(heatmapMatrix.map((m) => m.pattern))].slice(0, 8);
  const tfList = ['4H', 'D', 'W', 'M'];

  const calibrationChartData = calibration
    .filter((c) => (c.sampleSize || 0) >= 5)
    .map((c) => ({
      range: c.range,
      predicted: (c.predictedWinRate || 0) * 100,
      actual: (c.actualWinRate || 0) * 100,
      sampleSize: c.sampleSize,
    }));

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Brain className="h-12 w-12 animate-pulse text-slate-400" />
          <p className="text-sm text-slate-500">Loading intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Top Row: KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="card overflow-hidden p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Win Rate</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatPct(overview?.winRate ?? 0)}
          </p>
          <p className="muted mt-0.5 text-xs">Resolved alerts</p>
        </div>
        <div className="card overflow-hidden p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Avg R:R</p>
          <p className="text-2xl font-bold">{formatR(overview?.avgRR ?? 0)}</p>
          <p className="muted mt-0.5 text-xs">At MFE</p>
        </div>
        <div className="card overflow-hidden p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Profit Factor</p>
          <p className="text-2xl font-bold">{formatR(overview?.profitFactor ?? 0)}</p>
        </div>
        <div className="card overflow-hidden p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Outcomes</p>
          <p className="text-2xl font-bold">{overview?.totalAlerts ?? 0}</p>
          <p className="muted mt-0.5 text-xs">Tracked</p>
        </div>
        <div className="card overflow-hidden p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Expectancy</p>
          <p className="text-2xl font-bold">{formatR(overview?.expectancy ?? 0)}</p>
          <p className="muted mt-0.5 text-xs">R per trade</p>
        </div>
      </div>

      {/* Flow Impact Card */}
      {flow && (flow.sampleSizes?.aligned >= 10 || flow.sampleSizes?.opposing >= 10) && (
        <div
          className={`card overflow-hidden p-4 ${
            flow.isFlowUseful
              ? 'border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-400/20'
              : 'border-slate-200 dark:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-slate-500" />
            <h3 className="font-semibold">Options Flow Impact</h3>
          </div>
          <p className="mt-2 text-sm">
            {flow.isFlowUseful ? (
              <>
                <span className="text-emerald-600 dark:text-emerald-400">
                  Flow alignment adds {formatPct(flow.flowAlignmentEdge)} edge
                </span>
                — Aligned: {formatPct(flow.alignedWinRate)} vs opposing: {formatPct(flow.opposingWinRate)}
              </>
            ) : (
              <span className="text-slate-600 dark:text-slate-400">
                Flow data not adding significant edge ({formatPct(flow.flowAlignmentEdge)} diff). Consider reducing weight.
              </span>
            )}
          </p>
          <p className="muted mt-1 text-xs">
            n aligned: {flow.sampleSizes?.aligned ?? 0} · n opposing: {flow.sampleSizes?.opposing ?? 0}
          </p>
        </div>
      )}

      {/* Performance Heatmap: Pattern × Timeframe */}
      {heatmapMatrix.length > 0 && (
        <div className="card overflow-hidden p-4">
          <h3 className="mb-3 font-semibold">Performance Heatmap: Pattern × Timeframe</h3>
          <p className="muted mb-4 text-xs">Green &gt;60% · Amber 40–60% · Red &lt;40%</p>
          <div className="overflow-x-auto">
            <div className="inline-grid min-w-[320px] gap-1" style={{ gridTemplateColumns: 'minmax(5rem,1fr) repeat(4,minmax(3.5rem,1fr))' }}>
              <div className="p-2 text-[10px] font-medium uppercase text-slate-500" />
              {tfList.map((tf) => (
                <div key={tf} className="p-2 text-center text-xs font-medium text-slate-600 dark:text-slate-400">
                  {tf}
                </div>
              ))}
              {patternList.map((pattern) => (
                <React.Fragment key={pattern}>
                  <div className="flex items-center p-2 text-xs font-medium">
                    {pattern}
                  </div>
                  {tfList.map((tf) => {
                    const cell = getCell(pattern, tf);
                    return (
                      <HeatmapCell
                        key={`${pattern}-${tf}`}
                        wr={cell.wr}
                        sampleSize={cell.n}
                        pattern={pattern}
                        timeframe={tf}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Score Calibration Chart */}
      {calibrationChartData.length > 0 && (
        <div className="card overflow-hidden p-4">
          <h3 className="mb-3 font-semibold">Score Calibration</h3>
          <p className="muted mb-4 text-xs">Predicted vs actual win rate by score range</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibrationChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(value) => [`${value}%`, '']}
                  labelFormatter={(label) => `Score ${label}`}
                />
                <Bar dataKey="predicted" fill="#94a3b8" radius={[2, 2, 0, 0]} name="Predicted" />
                <Bar dataKey="actual" fill="#22c55e" radius={[2, 2, 0, 0]} name="Actual" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Symbol Leaderboard */}
      {symbols.length > 0 && (
        <div className="card overflow-hidden p-4">
          <h3 className="mb-3 font-semibold">Symbol Leaderboard (Strat Friendliness)</h3>
          <div className="flex flex-wrap gap-2">
            {symbols.slice(0, 12).map((s) => (
              <div
                key={s.symbol}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <span className="font-mono font-bold">{s.symbol}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{formatPct(s.winRate)}</span>
                <span className="muted text-xs">
                  {s.bestPattern ?? '—'} · {s.bestTimeframe ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights Feed */}
      {insights.length > 0 && (
        <div className="card overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Insights</h3>
            <button
              type="button"
              onClick={loadAll}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCcw size={12} />
              Refresh
            </button>
          </div>
          <div className="space-y-3">
            {insights.map((i, idx) => (
              <div
                key={idx}
                className={`flex gap-3 rounded-lg border p-3 ${
                  i.type === 'positive'
                    ? 'border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-400/20'
                    : i.type === 'warning'
                      ? 'border-amber-500/30 bg-amber-500/5 dark:border-amber-400/20'
                      : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <InsightIcon type={i.type} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title}</p>
                  <p className="muted mt-0.5 text-sm">{i.description}</p>
                  {i.action && (
                    <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">{i.action}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tuning History */}
      {tuningHistory.length > 0 && (
        <div className="card overflow-hidden p-4">
          <h3 className="mb-3 font-semibold">Tuning History</h3>
          <div className="space-y-2">
            {tuningHistory.slice(0, 5).map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <span className="text-sm">
                  {new Date(h.tunedAt).toLocaleString()} · n={h.sampleSize}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run Tuner */}
      {!isDemoMode && (
        <div className="card overflow-hidden p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Scoring Weight Tuner</h3>
              <p className="muted mt-0.5 text-sm">
                Adjust scanner weights based on outcome data. Requires 50+ resolved outcomes.
              </p>
            </div>
            <button
              type="button"
              onClick={handleTune}
              disabled={tuneLoading || (overview?.totalAlerts ?? 0) < 50}
              className="gradient-button flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
            >
              <Zap size={16} className={tuneLoading ? 'animate-pulse' : ''} />
              {tuneLoading ? 'Tuning...' : 'Run Tuner'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
