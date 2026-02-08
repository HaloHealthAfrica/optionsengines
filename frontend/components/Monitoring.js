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

function engineBadge(engine) {
  const value = String(engine || '').toUpperCase();
  if (value === 'A') return 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200';
  if (value === 'B') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function outcomeBadge(outcome) {
  const value = String(outcome || '').toLowerCase();
  if (value === 'success' || value === 'filled') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  }
  if (value === 'failed' || value === 'rejected') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  }
  if (value === 'pending') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (['accepted', 'filled', 'success'].includes(value)) return 'bg-emerald-100 text-emerald-700';
  if (['duplicate'].includes(value)) return 'bg-amber-100 text-amber-700';
  if (['pending', 'pending_execution'].includes(value)) return 'bg-sky-100 text-sky-700';
  if (value.includes('invalid') || value === 'error' || value === 'failed' || value === 'rejected') {
    return 'bg-rose-100 text-rose-700';
  }
  return 'bg-slate-100 text-slate-700';
}

function formatWhen(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

async function copyText(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(String(value));
  } catch {
    const input = document.createElement('textarea');
    input.value = String(value);
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

function DecisionEngineDetails({ detail, onDecisionClick }) {
  const overview = detail?.overview || {};
  const comparison = detail?.comparison || {};
  const breakdown = detail?.breakdown || {};
  const pipeline = detail?.pipeline || {};
  const decisions = detail?.decision_log || [];
  const bySymbol = breakdown.by_symbol || [];
  const byDecision = breakdown.by_decision || [];
  const byOutcome = breakdown.by_outcome || [];
  const byTimeframe = breakdown.by_timeframe || [];

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Decision Engine Details</h2>
        <p className="muted text-sm">Engine performance, decision logs, and pipeline health.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-sm font-medium">Processing rate</p>
          <p className="mt-3 text-2xl font-semibold">{overview.decisions_per_min ?? '--'} / min</p>
          <p className="muted text-xs">{overview.decisions_per_hour ?? '--'} / hour</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium">Success rate</p>
          <p className="mt-3 text-2xl font-semibold">{overview.success_rate ?? '--'}%</p>
          <p className="muted text-xs">Failures: {overview.failure_rate ?? '--'}%</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium">Avg decision latency</p>
          <p className="mt-3 text-2xl font-semibold">{overview.avg_latency_ms ?? '--'} ms</p>
          <p className="muted text-xs">Utilization: {overview.utilization_pct ?? '--'}%</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium">Failures (24h)</p>
          <p className="mt-3 text-2xl font-semibold">{overview.failures_24h ?? '--'}</p>
          <p className="muted text-xs">Decisions: {overview.total_decisions ?? '--'}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
        <div className="card p-6">
          <h3 className="text-base font-semibold">Decision Log</h3>
          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">TF</th>
                  <th className="pb-2">Decision</th>
                  <th className="pb-2">Confidence</th>
                  <th className="pb-2">Outcome</th>
                  <th className="pb-2">ms</th>
                  <th className="pb-2">Engine</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {decisions.map((row) => (
                  <tr
                    key={row.id}
                    className={onDecisionClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40' : ''}
                    onClick={() => {
                      if (onDecisionClick && row.experiment_id) {
                        onDecisionClick(row.experiment_id);
                      }
                    }}
                  >
                    <td className="py-3 text-xs text-slate-500">
                      {row.timestamp ? new Date(row.timestamp).toLocaleString() : '--'}
                    </td>
                    <td className="py-3 font-medium">{row.symbol}</td>
                    <td className="py-3">{row.timeframe}</td>
                    <td className="py-3">{row.decision}</td>
                    <td className="py-3">{row.confidence ?? '--'}%</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${outcomeBadge(row.outcome)}`}>
                        {row.outcome}
                      </span>
                    </td>
                    <td className="py-3">{row.processing_ms ?? '--'}</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${engineBadge(row.engine)}`}>
                        Engine {row.engine}
                      </span>
                    </td>
                  </tr>
                ))}
                {decisions.length === 0 && (
                  <tr>
                    <td className="py-4 text-sm text-slate-500" colSpan={8}>
                      No decision activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="card p-6">
            <h3 className="text-base font-semibold">Engine Comparison</h3>
            <div className="mt-4 grid gap-3 text-sm">
              {['A', 'B'].map((engine) => {
                const stats = comparison[engine] || {};
                return (
                  <div key={engine} className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">Engine {engine}</p>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${engineBadge(engine)}`}>
                        {stats.volume_label ?? 'Active'}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-xs text-slate-500">
                      <div className="flex items-center justify-between">
                        <span>Decisions</span>
                        <span className="text-slate-700 dark:text-slate-200">{stats.decisions ?? '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Success rate</span>
                        <span className="text-slate-700 dark:text-slate-200">{stats.success_rate ?? '--'}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Avg latency</span>
                        <span className="text-slate-700 dark:text-slate-200">{stats.avg_latency_ms ?? '--'} ms</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Queue depth</span>
                        <span className="text-slate-700 dark:text-slate-200">{stats.queue_depth ?? '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Why volume differs?</span>
                        <span className="text-slate-700 dark:text-slate-200">{stats.volume_reason ?? '--'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-base font-semibold">Processing Pipeline</h3>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Signals received</span>
                <span className="font-semibold">{pipeline.signals_received ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Decisions made</span>
                <span className="font-semibold">{pipeline.decisions_made ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Orders placed</span>
                <span className="font-semibold">{pipeline.orders_placed ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Queue depth A</span>
                <span className="font-semibold">{pipeline.queue_depth_a ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Queue depth B</span>
                <span className="font-semibold">{pipeline.queue_depth_b ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Stuck stage</span>
                <span className="font-semibold">{pipeline.stuck_stage ?? '--'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-base font-semibold">Decision Breakdown</h3>
          <div className="mt-4 grid gap-4 text-sm">
            <div>
              <p className="muted text-xs">By symbol</p>
              <div className="mt-2 grid gap-2">
                {bySymbol.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="font-semibold">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="muted text-xs">By decision type</p>
              <div className="mt-2 grid gap-2">
                {byDecision.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="font-semibold">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="muted text-xs">By outcome</p>
              <div className="mt-2 grid gap-2">
                {byOutcome.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="font-semibold">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <h3 className="text-base font-semibold">Timeframe Distribution</h3>
          <div className="mt-4 grid gap-2 text-sm">
            {byTimeframe.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span>{row.label}</span>
                <span className="font-semibold">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Monitoring({ initialView = 'overview' }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [limit, setLimit] = useState(25);
  const [activeFilter, setActiveFilter] = useState('all');
  const [testFilter, setTestFilter] = useState('all');
  const [dataSource, setDataSource] = useState('unknown');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [view, setView] = useState(initialView);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailStatus, setDetailStatus] = useState('idle');
  const [detailData, setDetailData] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailType, setDetailType] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [relatedWebhooks, setRelatedWebhooks] = useState([]);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [testForm, setTestForm] = useState({
    symbol: 'SPY',
    timeframe: '5m',
    signal_type: 'buy',
    count: 1,
  });
  const [testStatus, setTestStatus] = useState('idle');
  const [lastTestAt, setLastTestAt] = useState(null);
  const [activeTestSession, setActiveTestSession] = useState(null);
  const [testError, setTestError] = useState(null);

  const loadData = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch(
        `/api/monitoring/status?limit=${limit}&testFilter=${encodeURIComponent(testFilter)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error('Failed');
      setDataSource(response.headers.get('x-data-source') || 'unknown');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
    } catch (error) {
      setStatus('error');
    }
  }, [limit, testFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!activeTestSession) return;
    const interval = setInterval(() => {
      loadData();
    }, 2000);
    return () => clearInterval(interval);
  }, [activeTestSession, loadData]);

  const openDetail = useCallback((type, id, eventSnapshot) => {
    if (!type || !id) return;
    setDetailType(type);
    setDetailId(id);
    setDetailOpen(true);
    setDetailError(null);
    if (eventSnapshot) {
      setSelectedEvent(eventSnapshot);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailData(null);
    setDetailStatus('idle');
    setDetailError(null);
    setRelatedWebhooks([]);
  }, []);

  const loadDetail = useCallback(async (type, id) => {
    if (!type || !id) return;
    setDetailStatus('loading');
    try {
      const response = await fetch(`/api/monitoring/detail?type=${type}&id=${id}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Failed');
      const payload = await response.json();
      setDetailData(payload);
      setDetailStatus('success');
    } catch (error) {
      setDetailStatus('error');
      setDetailError('Failed to load transaction details.');
    }
  }, []);

  const loadRelated = useCallback(async (symbol, timeframe) => {
    if (!symbol || !timeframe) return;
    try {
      const response = await fetch(
        `/api/monitoring/related?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return;
      const payload = await response.json();
      setRelatedWebhooks(payload.related_webhooks || []);
    } catch {
      setRelatedWebhooks([]);
    }
  }, []);

  const sendQuickTest = useCallback(async (payload) => {
    setTestStatus('loading');
    setTestError(null);
    try {
      const endpoint =
        payload.count && payload.count > 1 ? '/api/testing/webhooks/send-batch' : '/api/testing/webhooks/send';
      const body =
        payload.count && payload.count > 1
          ? {
              scenario: payload.scenario || 'quick_test',
              symbols: payload.symbols && payload.symbols.length ? payload.symbols : [payload.symbol],
              timeframes: payload.timeframes && payload.timeframes.length ? payload.timeframes : [payload.timeframe],
              signal_types: payload.signal_types && payload.signal_types.length ? payload.signal_types : [payload.signal_type],
              count: Number(payload.count || 1),
              timing: payload.timing || 'realistic',
              realistic_prices: true,
            }
          : {
              symbol: payload.symbol,
              timeframe: payload.timeframe,
              signal_type: payload.signal_type,
            };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to send test webhook');
      }
      setLastTestAt(new Date().toISOString());
      setActiveTestSession(result.test_session_id || null);
      await loadData();
      setTestStatus('success');
    } catch (error) {
      setTestError(error?.message || 'Failed to send test webhook');
      setTestStatus('error');
    }
  }, [loadData]);

  useEffect(() => {
    if (!detailOpen) return;
    loadDetail(detailType, detailId);
  }, [detailOpen, detailType, detailId, loadDetail]);

  useEffect(() => {
    if (!detailOpen) return;
    const handler = (event) => {
      if (event.key === 'Escape') {
        closeDetail();
      }
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [detailOpen, closeDetail]);

  useEffect(() => {
    if (!detailOpen || !detailData?.order_data) return;
    const status = String(detailData.order_data.order_status || '').toLowerCase();
    if (!['pending', 'pending_execution'].includes(status)) return;
    const interval = setInterval(() => {
      loadDetail(detailType, detailId);
    }, 2000);
    return () => clearInterval(interval);
  }, [detailOpen, detailData, detailType, detailId, loadDetail]);

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
    if (testFilter === 'test' && !item.is_test) return false;
    if (testFilter === 'production' && item.is_test) return false;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'duplicate') return item.status === 'duplicate';
    if (activeFilter === 'failures') {
      return ['error', 'invalid_signature', 'invalid_payload'].includes(item.status);
    }
    return item.status === activeFilter;
  });

  const detailSignal = detailData?.signal_data || {};
  const detailOrder = detailData?.order_data || {};
  const detailDecision = detailData?.decision_engine || {};
  const detailExperiment = detailData?.experiment || {};
  const detailStatusValue = detailData?.status || detailOrder.order_status || '--';
  const detailTitle = detailSignal.symbol ? `${detailSignal.symbol} · ${detailSignal.timeframe || '--'}` : 'Transaction';

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
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'decision-engines', label: 'Decision engines' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`tab-button ${view === item.id ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
                aria-pressed={view === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[
              { id: 'all', label: 'Show all' },
              { id: 'production', label: 'Production only' },
              { id: 'test', label: 'Test only' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTestFilter(item.id)}
                className={`tab-button ${item.id === testFilter ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
                aria-pressed={item.id === testFilter}
              >
                {item.label}
              </button>
            ))}
          </div>
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

      {view === 'decision-engines' && (
        <DecisionEngineDetails detail={data?.decision_engine} onDecisionClick={(id) => openDetail('decision', id)} />
      )}

      {view === 'overview' && (
      <>
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
                    onClick={() => openDetail('webhook', item.event_id, item)}
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
                        {item.is_test && (
                          <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                            test
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
                  className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-100 px-3 py-2 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  onClick={() => openDetail('signal', item.signal_id)}
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
                  className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-100 px-3 py-2 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40"
                  onClick={() => openDetail('signal', item.signal_id)}
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
      </>
      )}

      <button
        type="button"
        onClick={() => setTestPanelOpen((open) => !open)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-900"
        aria-label="Open test webhooks panel"
      >
        🧪 Test Webhooks
      </button>

      {testPanelOpen && (
        <div className="fixed bottom-20 right-6 z-40 w-[320px] rounded-3xl border border-slate-100 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Quick Test</p>
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-slate-600"
              onClick={() => setTestPanelOpen(false)}
            >
              X
            </button>
          </div>
          <div className="mt-4 grid gap-3 text-xs">
            <label className="grid gap-1">
              <span className="muted">Symbol</span>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                value={testForm.symbol}
                onChange={(event) => setTestForm((prev) => ({ ...prev, symbol: event.target.value }))}
              >
                {['SPY', 'QQQ', 'SPX', 'AAPL', 'TSLA', 'MSFT'].map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="muted">Timeframe</span>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                value={testForm.timeframe}
                onChange={(event) => setTestForm((prev) => ({ ...prev, timeframe: event.target.value }))}
              >
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="muted">Signal</span>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                value={testForm.signal_type}
                onChange={(event) => setTestForm((prev) => ({ ...prev, signal_type: event.target.value }))}
              >
                {['buy', 'sell'].map((signal) => (
                  <option key={signal} value={signal}>
                    {signal}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="muted">Count</span>
              <input
                type="number"
                min={1}
                max={200}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                value={testForm.count}
                onChange={(event) => setTestForm((prev) => ({ ...prev, count: Number(event.target.value) }))}
              />
            </label>
            <button
              type="button"
              onClick={() => sendQuickTest(testForm)}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
            >
              {testStatus === 'loading' ? 'Sending...' : 'Send Test Webhook'}
            </button>
            {testError && <p className="text-xs text-rose-500">{testError}</p>}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
            <p>Active tests: {activeTestSession ? 1 : 0}</p>
            <p>Last test: {lastTestAt ? new Date(lastTestAt).toLocaleTimeString() : 'Never'}</p>
          </div>
          <div className="mt-4 grid gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                sendQuickTest({
                  symbols: ['SPY', 'QQQ', 'SPX'],
                  timeframes: ['1m', '5m', '15m', '1h', '1d'],
                  signal_types: ['buy', 'sell'],
                  count: 30,
                  scenario: 'mixed_trades_30',
                  timing: 'realistic',
                })
              }
              className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/40"
            >
              🚀 Run 30 Mixed Trades
            </button>
            <button
              type="button"
              onClick={() =>
                sendQuickTest({
                  symbols: ['SPY', 'QQQ', 'SPX', 'AAPL', 'TSLA', 'MSFT'],
                  timeframes: ['1m', '5m'],
                  signal_types: ['buy', 'sell'],
                  count: 100,
                  scenario: 'high_volume_100',
                  timing: 'rapid',
                })
              }
              className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/40"
            >
              📊 Simulate High Volume
            </button>
          </div>
        </div>
      )}

      {detailOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={closeDetail} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            className="absolute right-0 top-0 flex h-full w-full max-w-[600px] flex-col bg-white shadow-xl dark:bg-slate-950"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500">Webhook Details</p>
                <h2 id="drawer-title" className="text-lg font-semibold">
                  {detailTitle}
                </h2>
                <p className="text-xs text-slate-500">{detailData?.timestamp ? formatWhen(detailData.timestamp) : '--'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => copyText(detailData?.webhook_id || detailSignal.signal_id || detailOrder.order_id)}
                >
                  Copy ID
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => copyText(JSON.stringify(detailData || {}, null, 2))}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                  onClick={closeDetail}
                  aria-label="Close drawer"
                >
                  X
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {detailStatus === 'loading' && (
                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500">
                  Loading transaction details...
                </div>
              )}
              {detailStatus === 'error' && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
                  {detailError || 'Failed to load detail.'}
                  <button
                    type="button"
                    className="mt-3 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600"
                    onClick={() => loadDetail(detailType, detailId)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {detailStatus === 'success' && (
                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl border border-slate-100 bg-white/80 p-5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(detailStatusValue)}`}>
                        {detailStatusValue}
                      </span>
                      <span className="text-xs text-slate-500">
                        Processing: {detailData?.processing_time_ms ?? '--'} ms
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 text-xs text-slate-500 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase">Decision</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          {detailDecision.decision || '--'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase">Confidence</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          {detailDecision.confidence_score ?? '--'}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase">Order status</p>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          {detailOrder.order_status || '--'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Signal Data</h3>
                    <div className="mt-3 grid gap-2 text-xs text-slate-500">
                      <div className="flex items-center justify-between">
                        <span>Symbol</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{detailSignal.symbol || '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Timeframe</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{detailSignal.timeframe || '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Signal Type</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{detailSignal.signal_type || '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Signal ID</span>
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {detailSignal.signal_id || '--'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Decision Engine</h3>
                    <div className="mt-3 grid gap-2 text-xs text-slate-500">
                      <div className="flex items-center justify-between">
                        <span>Engine</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{detailDecision.engine || '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Decision</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{detailDecision.decision || '--'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Strategy</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {detailDecision.strategy_used || '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Processing</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {detailDecision.decision_time_ms ?? '--'} ms
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Order Details</h3>
                    {detailOrder.order_id ? (
                      <div className="mt-3 grid gap-2 text-xs text-slate-500">
                        <div className="flex items-center justify-between">
                          <span>Order</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{detailOrder.order_id}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Type</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{detailOrder.order_type}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Status</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{detailOrder.order_status}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Placed</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {formatWhen(detailOrder.placed_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Filled</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {formatWhen(detailOrder.filled_at)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No order placed.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Experiment</h3>
                    {detailExperiment.experiment_id ? (
                      <div className="mt-3 grid gap-2 text-xs text-slate-500">
                        <div className="flex items-center justify-between">
                          <span>Experiment ID</span>
                          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {detailExperiment.experiment_id}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Variant</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {detailExperiment.variant || '--'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No experiment attached.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 text-xs dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Errors & Warnings</h3>
                    <div className="mt-3 grid gap-2">
                      <div>
                        <p className="text-xs font-semibold text-amber-500">Warnings</p>
                        <p className="text-xs text-slate-500">
                          {detailData?.warnings?.length ? detailData.warnings.join(', ') : 'None'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-rose-500">Errors</p>
                        <p className="text-xs text-slate-500">
                          {detailData?.errors?.length ? detailData.errors.join(', ') : 'None'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 text-xs dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Processing Timeline</h3>
                    <div className="mt-3 grid gap-2">
                      {(detailData?.audit_trail || []).map((event, idx) => (
                        <div key={`${event.event}-${idx}`} className="flex items-center justify-between">
                          <span>{formatWhen(event.timestamp)}</span>
                          <span className="text-slate-700 dark:text-slate-200">{event.event}</span>
                          <span className="text-slate-400">{event.system}</span>
                        </div>
                      ))}
                      {(detailData?.audit_trail || []).length === 0 && (
                        <p className="text-xs text-slate-500">No audit trail available.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 p-5 text-xs dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Related Actions</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                        onClick={() => loadRelated(detailSignal.symbol, detailSignal.timeframe)}
                      >
                        View Similar Signals
                      </button>
                      {detailOrder.order_id && (
                        <button
                          type="button"
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                          onClick={() => openDetail('order', detailOrder.order_id)}
                        >
                          View Order Details
                        </button>
                      )}
                      {detailSignal.signal_id && (
                        <button
                          type="button"
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                          onClick={() => openDetail('signal', detailSignal.signal_id)}
                        >
                          View Signal
                        </button>
                      )}
                    </div>
                    {relatedWebhooks.length > 0 && (
                      <div className="mt-3 grid gap-2">
                        {relatedWebhooks.map((item) => (
                          <button
                            type="button"
                            key={item.event_id}
                            className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left text-xs dark:border-slate-800"
                            onClick={() => openDetail('webhook', item.event_id)}
                          >
                            <span>{formatWhen(item.created_at)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(item.status)}`}>
                              {item.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <details className="rounded-2xl border border-slate-100 p-5 text-xs dark:border-slate-800">
                    <summary className="cursor-pointer text-sm font-semibold">Raw Webhook Payload</summary>
                    <pre className="mt-3 max-h-60 overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-200">
                      {detailData?.raw_webhook_payload
                        ? JSON.stringify(detailData.raw_webhook_payload, null, 2).slice(0, 100000)
                        : 'No payload available.'}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
