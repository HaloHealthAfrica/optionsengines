'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, RefreshCcw, Sliders, Zap } from 'lucide-react';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${(n * 100).toFixed(1)}%`;
}

function formatR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleString();
}

function AdaptiveBadge({ badge }) {
  const v = String(badge || 'stable').toLowerCase();
  if (v === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">
        <span className="h-2 w-2 rounded-full bg-rose-500" />
        Adaptive Disabled
      </span>
    );
  }
  if (v === 'tuning_adjusted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Tuning Adjusted Recently
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Stable
    </span>
  );
}

export default function AdaptiveControlPanel() {
  const [status, setStatus] = useState(null);
  const [params, setParams] = useState(null);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, paramsRes, historyRes, summaryRes] = await Promise.all([
        fetch('/api/bias/adaptive-status', { cache: 'no-store' }),
        fetch('/api/bias/adaptive-params', { cache: 'no-store' }),
        fetch('/api/bias/adaptive-history', { cache: 'no-store' }),
        fetch('/api/bias/summary', { cache: 'no-store' }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (paramsRes.ok) setParams(await paramsRes.json());
      if (historyRes.ok) {
        const h = await historyRes.json();
        setHistory(h.history ?? []);
      }
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch (err) {
      console.error('Adaptive panel load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useAutoRefresh(loadAll, 60000, true);

  const handleToggle = async (enabled) => {
    setToggleLoading(true);
    setRunError(null);
    try {
      const res = await fetch('/api/bias/adaptive-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to update toggle');
      await loadAll();
    } catch (err) {
      setRunError(err?.message || 'Failed to update');
    } finally {
      setToggleLoading(false);
    }
  };

  const handleRunNow = async () => {
    setRunLoading(true);
    setRunError(null);
    try {
      const res = await fetch('/api/bias/run-adaptive', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      await loadAll();
    } catch (err) {
      setRunError(err?.message || 'Failed to run tuner');
    } finally {
      setRunLoading(false);
    }
  };

  const s = status ?? {};
  const lastRun = s.lastRunSummary ?? {};
  const paramsChanged = lastRun.parametersChanged ?? [];
  const manualRunAvailable = s.manualRunAvailable === true;

  if (loading && !status) {
    return (
      <section className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Adaptive Control Panel</h1>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card h-24 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Adaptive Control Panel</h1>
          <p className="muted text-sm">P&L feedback loop — monitoring and governance only. No direct parameter edits.</p>
        </div>
        <div className="flex items-center gap-3">
          <AdaptiveBadge badge={summary?.adaptiveBadge} />
          <button
            type="button"
            onClick={loadAll}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
            aria-label="Refresh"
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {runError && (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
          {runError}
        </div>
      )}

      {/* Performance Snapshot */}
      <div className="card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <BarChart3 size={20} />
          Performance Snapshot
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <p className="muted text-xs">Rolling Win Rate</p>
            <p className="mt-1 text-xl font-semibold">{formatPct(s.rollingWinRate)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <p className="muted text-xs">Rolling Avg R</p>
            <p className="mt-1 text-xl font-semibold">{formatR(s.rollingAvgR)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <p className="muted text-xs">Breakout in RANGE Win Rate</p>
            <p className="mt-1 text-xl font-semibold">{formatPct(s.breakoutInRangeWinRate)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <p className="muted text-xs">Acceleration Trade Avg R</p>
            <p className="mt-1 text-xl font-semibold">{formatR(s.accelerationTradeAvgR)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <p className="muted text-xs">Macro Drift Exit Avg R</p>
            <p className="mt-1 text-xl font-semibold">{formatR(s.macroDriftExitAvgR)}</p>
          </div>
        </div>
      </div>

      {/* Current Adaptive Parameters */}
      <div className="card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Sliders size={20} />
          Current Adaptive Parameters
        </h2>
        <p className="muted mb-4 text-xs">Read-only. All changes go through the tuner.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 text-left font-medium">Parameter</th>
                <th className="pb-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['rangeBreakoutMultiplier', params?.rangeBreakoutMultiplier],
                ['stateStrengthUpMultiplier', params?.stateStrengthUpMultiplier],
                ['macroDriftThreshold', params?.macroDriftThreshold],
                ['latePhaseNegativeMultiplier', params?.latePhaseNegativeMultiplier],
              ].map(([key, val]) => {
                const recentlyChanged = paramsChanged.some((c) => c.key === key);
                return (
                  <tr key={key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">
                      <span className="font-medium">{key}</span>
                      {recentlyChanged && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
                          Recently changed
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono">{val != null ? String(val) : '--'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Last Adaptive Run */}
      <div className="card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Zap size={20} />
          Last Adaptive Run
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="muted">Date</span>
            <span>{formatDate(lastRun.date ?? s.lastAdaptiveUpdate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="muted">Updated?</span>
            <span>{lastRun.tunerUpdated ? 'Yes' : 'No'}</span>
          </div>
          {paramsChanged.length > 0 ? (
            <div>
              <p className="muted mb-2">Changes Applied</p>
              <ul className="list-inside list-disc space-y-1">
                {paramsChanged.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono">{c.key}</span>: {c.oldValue} → {c.newValue}
                    {c.reason && <span className="muted ml-1">— {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted italic">No tuning needed — system stable.</p>
          )}
        </div>
      </div>

      {/* Change History */}
      <div className="card p-6">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setHistoryExpanded(!historyExpanded)}
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Change History
            <span className="muted text-sm font-normal">(last 30)</span>
          </h2>
          {historyExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </button>
        {historyExpanded && (
          <div className="mt-4 overflow-x-auto">
            {history.length === 0 ? (
              <p className="muted text-sm">No change history yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="pb-2 text-left font-medium">Date</th>
                    <th className="pb-2 text-left font-medium">Parameter</th>
                    <th className="pb-2 text-right font-medium">Old</th>
                    <th className="pb-2 text-right font-medium">New</th>
                    <th className="pb-2 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 text-xs">{formatDate(row.date)}</td>
                      <td className="py-2 font-mono">{row.parameter ?? '--'}</td>
                      <td className="py-2 text-right">{row.oldValue ?? '--'}</td>
                      <td className="py-2 text-right">{row.newValue ?? '--'}</td>
                      <td className="py-2 muted max-w-[200px] truncate" title={row.reason}>
                        {row.reason ?? '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Adaptive Status Toggle */}
      <div className="card p-6">
        <h2 className="mb-4 text-lg font-semibold">Adaptive Status</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                s.adaptiveEnabled ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className="font-medium">{s.adaptiveEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={toggleLoading || s.adaptiveEnabled}
              onClick={() => handleToggle(true)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                s.adaptiveEnabled
                  ? 'bg-emerald-500/20 text-emerald-700 dark:bg-emerald-500/30 dark:text-emerald-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Enable
            </button>
            <button
              type="button"
              disabled={toggleLoading || !s.adaptiveEnabled}
              onClick={() => handleToggle(false)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                !s.adaptiveEnabled
                  ? 'bg-slate-500/20 text-slate-700 dark:bg-slate-400/20 dark:text-slate-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Disable
            </button>
          </div>
          <p className="muted text-xs">
            When disabled, the tuner runs in dry-run mode: it computes changes but does not apply them.
          </p>
        </div>
      </div>

      {/* Manual Run (Admin, non-production only) */}
      {manualRunAvailable && (
        <div className="card border-amber-200 p-6 dark:border-amber-800">
          <h2 className="mb-2 text-lg font-semibold">Manual Run (Admin Only)</h2>
          <p className="muted mb-4 text-xs">Available only in development. Admin role required.</p>
          <button
            type="button"
            disabled={runLoading}
            onClick={handleRunNow}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Zap size={16} className={runLoading ? 'animate-spin' : ''} />
            Run Adaptive Tuner Now
          </button>
        </div>
      )}
    </section>
  );
}
