'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RadioTower, RefreshCcw } from 'lucide-react';

const limits = [10, 25];

function statusBadge(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'accepted') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (value === 'duplicate') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
  if (value.includes('invalid')) return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  if (value === 'error') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

export default function Monitoring() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [limit, setLimit] = useState(25);
  const [activeFilter, setActiveFilter] = useState('all');
  const [dataSource, setDataSource] = useState('unknown');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch(`/api/monitoring/status?limit=${limit}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed');
      setDataSource(response.headers.get('x-data-source') || 'unknown');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
    } catch (error) {
      setStatus('error');
    }
  }, [limit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = data?.webhooks?.summary_24h || {};
  const ws = data?.websocket || {};
  const providers = data?.providers || {};
  const pipeline = data?.pipeline || {};
  const signalSummary = pipeline.signals_24h || {};
  const orderSummary = pipeline.orders_24h || {};
  const lastActivity = pipeline.last_activity || {};
  const workerErrors = pipeline.worker_errors || {};
  const recentSignals = pipeline.recent_signals || [];
  const recentRejections = pipeline.recent_rejections || [];
  const recent = data?.webhooks?.recent || [];
  const engineStats = data?.engines?.by_variant_24h || {};
  const recentFiltered = recent.filter((item) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'duplicate') return item.status === 'duplicate';
    if (activeFilter === 'failures') {
      return ['error', 'invalid_signature', 'invalid_payload'].includes(item.status);
    }
    return item.status === activeFilter;
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="muted text-sm">Webhook throughput, provider health, and streaming status.</p>
          <p className="muted text-xs">
            Data source: {dataSource} · Limit: {limit} · Updated:{' '}
            {data?.timestamp ? new Date(data.timestamp).toLocaleString() : '--'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            {limits.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setLimit(item)}
                className={`tab-button ${item === limit ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
                aria-pressed={item === limit}
              >
                Last {item}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadData}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
            aria-label="Refresh monitoring"
          >
            <RefreshCcw size={16} className={status === 'loading' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">Unable to load monitoring data.</div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`card p-5 text-left transition ${
            activeFilter === 'all' ? 'ring-2 ring-brand-400/60' : 'hover:-translate-y-0.5'
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Webhooks (24h)</p>
            <Activity size={16} className="text-slate-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold">{summary.total ?? '--'}</p>
          <p className="muted text-xs">Accepted: {summary.accepted ?? 0}</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('failures')}
          className={`card p-5 text-left transition ${
            activeFilter === 'failures' ? 'ring-2 ring-rose-400/60' : 'hover:-translate-y-0.5'
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Webhook Failures</p>
            <AlertTriangle size={16} className="text-rose-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold">{summary.error ?? 0}</p>
          <p className="muted text-xs">
            Invalid: {(summary.invalid_signature ?? 0) + (summary.invalid_payload ?? 0)}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('duplicate')}
          className={`card p-5 text-left transition ${
            activeFilter === 'duplicate' ? 'ring-2 ring-amber-400/60' : 'hover:-translate-y-0.5'
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Duplicates</p>
            <CheckCircle2 size={16} className="text-amber-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold">{summary.duplicate ?? 0}</p>
          <p className="muted text-xs">Deduplicated signals</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className="card p-5 text-left transition hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">WebSocket</p>
            <RadioTower size={16} className="text-sky-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold">{ws.connected ? 'Connected' : 'Offline'}</p>
          <p className="muted text-xs">
            {ws.enabled ? 'Enabled' : 'Disabled'} · {ws.subscribedSymbols?.length || 0} symbols
          </p>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Webhooks</h2>
            <span className="muted text-xs">
              Showing {recentFiltered.length} of {recent.length}
            </span>
          </div>
          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">TF</th>
                  <th className="pb-2">Variant</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {recentFiltered.map((item) => (
                  <tr
                    key={item.event_id || item.request_id}
                    className="cursor-pointer text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/40"
                    onClick={() => setSelectedEvent(item)}
                  >
                    <td className="py-3 text-xs text-slate-500">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : '--'}
                    </td>
                    <td className="py-3 font-medium">{item.symbol || '--'}</td>
                    <td className="py-3">{item.timeframe || '--'}</td>
                    <td className="py-3">{item.variant || '--'}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadge(item.status)}`}
                        >
                          {item.status}
                        </span>
                        {item.signal_id && (
                          <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-200">
                            signal
                          </span>
                        )}
                        {item.variant && (
                          <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                            Engine {item.variant}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-right text-xs">{item.processing_time_ms ?? '--'}</td>
                  </tr>
                ))}
                {recentFiltered.length === 0 && status !== 'loading' && (
                  <tr>
                    <td className="py-4 text-sm text-slate-500" colSpan={6}>
                      No webhook activity for this filter yet.
                    </td>
                  </tr>
                )}
                {status === 'loading' && (
                  <tr>
                    <td className="py-4 text-sm text-slate-500" colSpan={6}>
                      Loading webhooks...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-white/60 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/40">
            <p className="text-sm font-semibold">Selected webhook</p>
            {selectedEvent ? (
              <div className="mt-2 grid gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="muted">Status</span>
                  <span className="font-semibold">{selectedEvent.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Request ID</span>
                  <span className="font-mono text-[11px]">{selectedEvent.request_id || '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Signal ID</span>
                  <span className="font-mono text-[11px]">{selectedEvent.signal_id || '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Experiment</span>
                  <span className="font-mono text-[11px]">{selectedEvent.experiment_id || '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Error</span>
                  <span className="text-rose-500">{selectedEvent.error_message || 'None'}</span>
                </div>
              </div>
            ) : (
              <p className="muted mt-2">Click a webhook row to see details.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold">Pipeline Health</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
                <span>Signals (24h)</span>
                <span className="font-semibold">
                  {signalSummary.total ?? 0} · P {signalSummary.pending ?? 0} · A {signalSummary.approved ?? 0} · R{' '}
                  {signalSummary.rejected ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
                <span>Orders (24h)</span>
                <span className="font-semibold">
                  {orderSummary.total ?? 0} · Pending {orderSummary.pending_execution ?? 0} · Filled{' '}
                  {orderSummary.filled ?? 0} · Failed {orderSummary.failed ?? 0}
                </span>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="muted">Last signal</span>
                  <span>{lastActivity.signal ? new Date(lastActivity.signal).toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Last order</span>
                  <span>{lastActivity.order ? new Date(lastActivity.order).toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Last trade</span>
                  <span>{lastActivity.trade ? new Date(lastActivity.trade).toLocaleString() : '--'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="muted">Last position</span>
                  <span>{lastActivity.position ? new Date(lastActivity.position).toLocaleString() : '--'}</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
                <span className="muted">Worker errors</span>
                <span className="font-semibold">
                  {workerErrors.total ?? 0} {workerErrors.total ? `(${Object.keys(workerErrors.bySource || {}).length} sources)` : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold">Decision Engine Mix (24h)</h2>
            <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                <span>Engine A</span>
                <span className="font-semibold">{engineStats.A ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                <span>Engine B</span>
                <span className="font-semibold">{engineStats.B ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold">Provider Health</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              {Object.entries(providers.circuit_breakers || {}).map(([provider, status]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800"
                >
                  <span className="capitalize">{provider}</span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      status.state === 'open'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                        : status.state === 'half-open'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                    }`}
                  >
                    {status.state}
                  </span>
                </div>
              ))}
              {Object.keys(providers.circuit_breakers || {}).length === 0 && (
                <p className="muted text-sm">No provider data yet.</p>
              )}
            </div>
            <div className="mt-4 text-xs text-slate-500">
              Down: {(providers.down || []).length ? providers.down.join(', ') : 'None'}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold">Recent Signals</h2>
            <div className="mt-3 grid gap-2 text-xs">
              {recentSignals.slice(0, 6).map((item) => (
                <div
                  key={item.signal_id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-3 py-2 dark:border-slate-800"
                >
                  <span className="font-medium">{item.symbol || '--'}</span>
                  <span className="muted">{item.timeframe || '--'}</span>
                  <span className="muted">{item.status || '--'}</span>
                  <span>{item.created_at ? new Date(item.created_at).toLocaleTimeString() : '--'}</span>
                </div>
              ))}
              {recentSignals.length === 0 && <p className="muted text-sm">No signals recorded yet.</p>}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold">Recent Rejections</h2>
            <div className="mt-3 grid gap-2 text-xs">
              {recentRejections.slice(0, 6).map((item) => (
                <div
                  key={item.signal_id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-3 py-2 dark:border-slate-800"
                >
                  <span className="font-medium">{item.symbol || '--'}</span>
                  <span className="muted">{item.timeframe || '--'}</span>
                  <span className="text-rose-500">{item.rejection_reason || 'unknown'}</span>
                  <span>{item.created_at ? new Date(item.created_at).toLocaleTimeString() : '--'}</span>
                </div>
              ))}
              {recentRejections.length === 0 && <p className="muted text-sm">No rejections recorded.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
