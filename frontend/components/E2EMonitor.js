'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCcw, TrendingUp } from 'lucide-react';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

function statusBadge(status) {
  const v = String(status || '').toLowerCase();
  if (v === 'accepted') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (v === 'duplicate') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
  if (v.includes('invalid') || v === 'error') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function formatWhen(value) {
  if (!value) return '--';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function formatPnl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

export default function E2EMonitor() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/e2e-monitor?limit=20&windowHours=24', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed');
      const payload = await res.json();
      setData(payload);
      setStatus('success');
      setLastUpdated(Date.now());
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useAutoRefresh(loadData, 15000, true);

  const webhooks = data?.webhooks ?? [];
  const biasState = data?.bias_state ?? [];
  const pnl = data?.pnl ?? {};
  const recentClosed = data?.recent_closed ?? [];
  const e2eMode = data?.e2e_test_mode ?? false;
  const adaptive = data?.adaptive_status ?? {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">E2E Monitor</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Webhooks, bias state, risk, exposure, exits, P&L, adaptive tuner
          </p>
        </div>
        <div className="flex items-center gap-3">
          {e2eMode && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
              E2E_TEST_MODE
            </span>
          )}
          <button
            type="button"
            onClick={loadData}
            disabled={status === 'loading'}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <RefreshCcw size={16} className={status === 'loading' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-3 rounded-xl bg-rose-50 p-4 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle size={20} />
          <span>Failed to load E2E data. Check backend connection.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-base font-semibold">Last 20 Webhooks</h2>
          <div className="mt-4 overflow-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-950 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Dir</th>
                  <th className="pb-2">TF</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {webhooks.map((w) => (
                  <tr key={w.event_id || w.signal_id || Math.random()}>
                    <td className="py-2 font-medium">{w.symbol ?? '--'}</td>
                    <td className="py-2">{w.direction ?? '--'}</td>
                    <td className="py-2">{w.timeframe ?? '--'}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(w.status)}`}>
                        {w.status ?? '--'}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-slate-500">{formatWhen(w.created_at)}</td>
                  </tr>
                ))}
                {webhooks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No webhooks in window
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-base font-semibold">Bias State at Decision Time</h2>
          <div className="mt-4 overflow-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Bias</th>
                  <th className="pb-2">Regime</th>
                  <th className="pb-2">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {biasState.map((b, i) => (
                  <tr key={`${b.symbol}-${b.updated_at}-${i}`}>
                    <td className="py-2 font-medium">{b.symbol ?? '--'}</td>
                    <td className="py-2">{b.bias_score != null ? Number(b.bias_score).toFixed(2) : '--'}</td>
                    <td className="py-2">{b.regime_type ?? '--'}</td>
                    <td className="py-2 text-xs text-slate-500">{formatWhen(b.updated_at)}</td>
                  </tr>
                ))}
                {biasState.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No bias state in window
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total P&L (24h)</p>
          <p className={`mt-2 text-2xl font-semibold ${(pnl.total ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatPnl(pnl.total)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Win Rate</p>
          <p className="mt-2 text-2xl font-semibold">{pnl.win_rate ?? 0}%</p>
          <p className="text-xs text-slate-500">{pnl.wins ?? 0}W / {pnl.losses ?? 0}L</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Closed Positions</p>
          <p className="mt-2 text-2xl font-semibold">{pnl.closed_count ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Adaptive Tuner</p>
          <p className="mt-2 flex items-center gap-2">
            {adaptive.enabled !== false ? (
              <CheckCircle2 size={20} className="text-emerald-500" />
            ) : (
              <AlertTriangle size={20} className="text-amber-500" />
            )}
            <span className="font-semibold">{adaptive.enabled !== false ? 'Enabled' : 'Disabled'}</span>
          </p>
          {data?.e2e_test_mode && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Dry run in E2E mode</p>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-base font-semibold">Recent Closed Positions (Exit Decision, P&L)</h2>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="pb-2">Symbol</th>
                <th className="pb-2">P&L</th>
                <th className="pb-2">Exit Reason</th>
                <th className="pb-2">Exit Type</th>
                <th className="pb-2">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentClosed.map((p) => (
                <tr key={p.position_id}>
                  <td className="py-2 font-medium">{p.symbol ?? '--'}</td>
                  <td className={`py-2 font-medium ${(p.realized_pnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatPnl(p.realized_pnl)}
                  </td>
                  <td className="py-2">{p.exit_reason ?? '--'}</td>
                  <td className="py-2">{p.exit_type ?? '--'}</td>
                  <td className="py-2 text-xs text-slate-500">{formatWhen(p.exit_timestamp)}</td>
                </tr>
              ))}
              {recentClosed.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No closed positions in window
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {lastUpdated && (
        <p className="text-xs text-slate-500">
          Last updated: {new Date(lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  );
}
