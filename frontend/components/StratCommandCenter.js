'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCcw,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Bell,
  BarChart3,
  AlertCircle,
  X,
} from 'lucide-react';

// TODO: Replace with API call to strat scanning/alerting backend
const MOCK_ALERTS = [
  {
    id: 'a1',
    symbol: 'SHOP',
    direction: 'long',
    timeframe: 'D',
    setupType: '2-1-2 Rev',
    score: 87,
    status: 'pending',
    timestamp: '2026-02-16T11:51:00',
    entry: 138.5,
    target: 145,
    stop: 134.2,
    rr: 1.51,
    reversalLevel: 139.1,
    condition: 'Break above 139.10 confirms',
    optionsPlay: '139c & 145c 2/21 Exp',
    c1Shape: 'bullish engulfing',
    rvol: 67,
    atr: 5.14,
  },
  {
    id: 'a2',
    symbol: 'NVDA',
    direction: 'long',
    timeframe: '4H',
    setupType: '2-1-2 Rev',
    score: 92,
    status: 'triggered',
    timestamp: '2026-02-16T10:30:00',
    entry: 138.5,
    target: 145,
    stop: 134.2,
    rr: 1.51,
    reversalLevel: 139.1,
    condition: 'Break above 139.10 confirms',
    optionsPlay: '139c & 145c 2/21 Exp',
    c1Shape: 'bullish engulfing',
    rvol: 67,
    atr: 5.14,
  },
  {
    id: 'a3',
    symbol: 'AAPL',
    direction: 'short',
    timeframe: 'D',
    setupType: '3-1-2 Cont',
    score: 78,
    status: 'triggered',
    timestamp: '2026-02-16T09:45:00',
    entry: 182.2,
    target: 175,
    stop: 186,
    rr: 1.47,
    reversalLevel: null,
    condition: 'Hold below 183.00',
    optionsPlay: '180p & 175p 2/28 Exp',
    c1Shape: 'bearish engulfing',
    rvol: -12,
    atr: 2.8,
  },
  {
    id: 'a4',
    symbol: 'TSLA',
    direction: 'long',
    timeframe: 'W',
    setupType: '2-1-2 Rev',
    score: 81,
    status: 'watching',
    timestamp: '2026-02-16T08:00:00',
    entry: 245,
    target: 265,
    stop: 232,
    rr: 1.54,
    reversalLevel: 248,
    condition: 'Break above 248 confirms',
    optionsPlay: '245c & 265c 3/7 Exp',
    c1Shape: 'hammer',
    rvol: 23,
    atr: 12.5,
  },
  {
    id: 'a5',
    symbol: 'META',
    direction: 'long',
    timeframe: 'D',
    setupType: '2-1-2 Rev',
    score: 85,
    status: 'pending',
    timestamp: '2026-02-16T07:30:00',
    entry: 512,
    target: 535,
    stop: 498,
    rr: 1.64,
    reversalLevel: 518,
    condition: 'Break above 518 confirms',
    optionsPlay: '515c & 535c 2/21 Exp',
    c1Shape: 'bullish engulfing',
    rvol: 45,
    atr: 8.2,
  },
];

function ScoreBadge({ score }) {
  const n = Number(score) || 0;
  const cls =
    n >= 85
      ? 'bg-emerald-500/20 text-emerald-600 dark:bg-emerald-400/30 dark:text-emerald-300 border-emerald-500/40'
      : n >= 75
        ? 'bg-amber-500/20 text-amber-600 dark:bg-amber-400/30 dark:text-amber-300 border-amber-500/40'
        : 'bg-rose-500/20 text-rose-600 dark:bg-rose-400/30 dark:text-rose-300 border-rose-500/40';
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-bold ${cls}`}
    >
      {n}
    </span>
  );
}

function StatusDot({ status }) {
  const color =
    status === 'triggered'
      ? 'bg-emerald-500'
      : status === 'pending'
        ? 'bg-amber-500'
        : 'bg-blue-500';
  const pulse = status === 'triggered' || status === 'pending';
  return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color} ${pulse ? '' : 'animate-none'}`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function AlertCard({
  alert,
  expanded,
  onToggle,
  onCreatePlan,
  onAlertMe,
  onChart,
}) {
  const isTriggered = alert.status === 'triggered';
  const dirLabel = alert.direction === 'long' ? '▲ LONG' : '▼ SHORT';
  const dirCls =
    alert.direction === 'long'
      ? 'bg-emerald-500/20 text-emerald-600 dark:bg-emerald-400/30 dark:text-emerald-300'
      : 'bg-rose-500/20 text-rose-600 dark:bg-rose-400/30 dark:text-rose-300';

  return (
    <div
      className={`rounded-xl border transition-all ${
        isTriggered
          ? 'border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-400/20 dark:bg-emerald-500/10'
          : 'border-slate-200 dark:border-slate-700/60 dark:bg-slate-900/40'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
      >
        <ScoreBadge score={alert.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{alert.symbol}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${dirCls}`}>
              {dirLabel}
            </span>
            <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs dark:bg-slate-700">
              {alert.timeframe}
            </span>
            <span className="muted text-sm">{alert.setupType}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <StatusDot status={alert.status} />
            <span className="uppercase tracking-wide">
              {alert.status} · {new Date(alert.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="font-mono text-sm">${alert.entry?.toFixed(2)}</p>
          <p className="muted text-xs">R:R {alert.rr?.toFixed(2)}</p>
        </div>
        <ChevronDown
          size={18}
          className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700/60">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-wrap gap-4 font-mono text-sm">
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-widest text-slate-500">
                  Entry
                </p>
                <p>${alert.entry?.toFixed(2)}</p>
              </div>
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-widest text-slate-500">
                  Target
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  ${alert.target?.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-widest text-slate-500">
                  Stop
                </p>
                <p className="text-rose-600 dark:text-rose-400">
                  ${alert.stop?.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-widest text-slate-500">
                  R:R
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  {alert.rr?.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
          {alert.reversalLevel && (
            <p className="mt-2 text-sm">
              Reversal above ${alert.reversalLevel.toFixed(2)}
            </p>
          )}
          {alert.condition && (
            <div className="mt-2 rounded-lg bg-amber-500/20 px-3 py-2 text-sm dark:bg-amber-500/15">
              ▲ {alert.condition}
            </div>
          )}
          {alert.optionsPlay && (
            <div className="mt-2 rounded-lg bg-blue-500/20 px-3 py-2 font-mono text-sm text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              ✉ {alert.optionsPlay}
            </div>
          )}
          <p className="muted mt-2 text-xs">
            C1: {alert.c1Shape} · RVOL:{' '}
            <span
              className={
                (alert.rvol ?? 0) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              {(alert.rvol ?? 0) >= 0 ? '+' : ''}
              {alert.rvol}%
            </span>{' '}
            · ATR: {alert.atr}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCreatePlan(alert);
              }}
              className="gradient-button flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              <Plus size={14} />
              Create Plan
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAlertMe(alert);
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <Bell size={14} />
              Alert Me
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChart(alert);
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <BarChart3 size={14} />
              Chart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePlanFromAlertModal({ alert, onConfirm, onCancel }) {
  const [notes, setNotes] = useState('');
  if (!alert) return null;

  const dirLabel = alert.direction === 'long' ? '▲ LONG' : '▼ SHORT';
  const dirCls =
    alert.direction === 'long'
      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : 'bg-rose-500/20 text-rose-700 dark:text-rose-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[90vh] w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold">Create Plan</h2>
            <p className="muted text-sm">
              From {alert.setupType} alert on {alert.symbol}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Symbol
              </p>
              <p className="font-bold">{alert.symbol}</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Direction
              </p>
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${dirCls}`}>
                {dirLabel}
              </span>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Entry
              </p>
              <p className="font-mono text-emerald-600 dark:text-emerald-400">
                ${alert.entry?.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Target
              </p>
              <p className="font-mono text-emerald-600 dark:text-emerald-400">
                ${alert.target?.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Stop
              </p>
              <p className="font-mono text-rose-600 dark:text-rose-400">
                ${alert.stop?.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Options
              </p>
              <p className="font-mono text-blue-600 dark:text-blue-400">
                {alert.optionsPlay}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add trade thesis, reminders..."
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </div>
        <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            onClick={() => onConfirm({ ...alert, notes })}
            className="gradient-button flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            Confirm Plan
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatePlanManualModal({ onConfirm, onCancel }) {
  const [form, setForm] = useState({
    symbol: '',
    direction: 'long',
    entry: '',
    target: '',
    stop: '',
    options: '',
    notes: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[90vh] w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Create Plan (Manual)</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Symbol
              </label>
              <input
                type="text"
                value={form.symbol}
                onChange={(e) =>
                  setForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))
                }
                placeholder="SPY"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Direction
              </label>
              <select
                value={form.direction}
                onChange={(e) =>
                  setForm((p) => ({ ...p, direction: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Entry
              </label>
              <input
                type="text"
                value={form.entry}
                onChange={(e) => setForm((p) => ({ ...p, entry: e.target.value }))}
                placeholder="138.50"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Target
              </label>
              <input
                type="text"
                value={form.target}
                onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))}
                placeholder="145.00"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Stop
              </label>
              <input
                type="text"
                value={form.stop}
                onChange={(e) => setForm((p) => ({ ...p, stop: e.target.value }))}
                placeholder="134.20"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                Options
              </label>
              <input
                type="text"
                value={form.options}
                onChange={(e) => setForm((p) => ({ ...p, options: e.target.value }))}
                placeholder="139c & 145c 2/21 Exp"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Add trade thesis, reminders..."
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              className="gradient-button flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              Confirm Plan
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StratCommandCenter() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS);
  const [plans, setPlans] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tfFilter, setTfFilter] = useState('all');
  const [dirFilter, setDirFilter] = useState('all');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [createFromAlert, setCreateFromAlert] = useState(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [apiData, setApiData] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [planTab, setPlanTab] = useState('Active');

  // TODO: Replace with WebSocket connection for real-time alerts (MarketScanner In-Force style)
  // useEffect(() => { const ws = new WebSocket(...); return () => ws.close(); }, []);

  const loadApiData = useCallback(async () => {
    try {
      const res = await fetch('/api/strat-plan/dashboard');
      if (res.status === 503) {
        setApiError('Strat Plan Lifecycle disabled. Set ENABLE_STRAT_PLAN_LIFECYCLE=true.');
        setApiData(null);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setApiData(payload);
      setApiError(null);
    } catch (err) {
      setApiError(err?.message);
      setApiData(null);
    }
  }, []);

  useEffect(() => {
    loadApiData();
  }, [loadApiData]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (tfFilter !== 'all' && a.timeframe !== tfFilter) return false;
      if (dirFilter !== 'all' && a.direction !== dirFilter) return false;
      if (symbolSearch && !a.symbol.toUpperCase().includes(symbolSearch.toUpperCase()))
        return false;
      return true;
    });
  }, [alerts, statusFilter, tfFilter, dirFilter, symbolSearch]);

  const stats = useMemo(() => {
    const triggered = alerts.filter((a) => a.status === 'triggered').length;
    const pending = alerts.filter((a) => a.status === 'pending').length;
    const watching = alerts.filter((a) => a.status === 'watching').length;
    const activePlans = plans.length;
    return {
      total: alerts.length,
      triggered,
      pending,
      watching,
      activePlans,
    };
  }, [alerts, plans]);

  const handleConfirmPlanFromAlert = async (alertWithNotes) => {
    if (isDemoMode) {
      const plan = {
        id: `p-${Date.now()}`,
        symbol: alertWithNotes.symbol,
        direction: alertWithNotes.direction,
        entry: alertWithNotes.entry,
        target: alertWithNotes.target,
        stop: alertWithNotes.stop,
        options: alertWithNotes.optionsPlay,
        rr: alertWithNotes.rr,
        notes: alertWithNotes.notes,
        active: true,
        status: 'armed',
      };
      setPlans((p) => [...p, plan]);
      setCreateFromAlert(null);
      return;
    }
    const planPayload = {
      symbol: alertWithNotes.symbol,
      direction: alertWithNotes.direction,
      timeframe: alertWithNotes.timeframe === 'D' ? '1d' : alertWithNotes.timeframe === 'W' ? '1w' : '4h',
      raw_payload: {
        entry: alertWithNotes.entry,
        target: alertWithNotes.target,
        stop: alertWithNotes.stop,
        options: alertWithNotes.optionsPlay,
        rr: alertWithNotes.rr,
        notes: alertWithNotes.notes,
        setupType: alertWithNotes.setupType,
      },
    };
    try {
      const res = await fetch('/api/strat-plan/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planPayload),
      });
      const json = await res.json();
      if (!res.ok && !json?.plan) throw new Error(json?.error || json?.reason || 'Create failed');
      const plan = {
        id: json.plan?.plan_id || `p-${Date.now()}`,
        symbol: alertWithNotes.symbol,
        direction: alertWithNotes.direction,
        entry: alertWithNotes.entry,
        target: alertWithNotes.target,
        stop: alertWithNotes.stop,
        options: alertWithNotes.optionsPlay,
        rr: alertWithNotes.rr,
        notes: alertWithNotes.notes,
        active: true,
        status: 'armed',
      };
      setPlans((p) => [...p, plan]);
    } catch (err) {
      console.error('Create plan failed:', err);
      setApiError(err?.message);
    }
    setCreateFromAlert(null);
    loadApiData();
  };

  const handleConfirmPlanManual = async (form) => {
    if (isDemoMode) {
      const plan = {
        id: `p-${Date.now()}`,
        symbol: form.symbol,
        direction: form.direction,
        entry: form.entry,
        target: form.target,
        stop: form.stop,
        options: form.options,
        notes: form.notes,
        active: true,
        status: 'armed',
      };
      setPlans((p) => [...p, plan]);
      setShowManualModal(false);
      return;
    }
    const planPayload = {
      symbol: form.symbol,
      direction: form.direction,
      timeframe: '1d',
      raw_payload: {
        entry: form.entry,
        target: form.target,
        stop: form.stop,
        options: form.options,
        notes: form.notes,
      },
    };
    try {
      const res = await fetch('/api/strat-plan/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planPayload),
      });
      const json = await res.json();
      if (!res.ok && !json?.plan) throw new Error(json?.error || json?.reason || 'Create failed');
      const plan = {
        id: json.plan?.plan_id || `p-${Date.now()}`,
        symbol: form.symbol,
        direction: form.direction,
        entry: form.entry,
        target: form.target,
        stop: form.stop,
        options: form.options,
        notes: form.notes,
        active: true,
        status: 'armed',
      };
      setPlans((p) => [...p, plan]);
    } catch (err) {
      console.error('Create plan failed:', err);
      setApiError(err?.message);
    }
    setShowManualModal(false);
    loadApiData();
  };

  const handleRemovePlan = (id) => {
    setPlans((p) => p.filter((x) => x.id !== id));
  };

  const planSummary = useMemo(() => {
    const longs = plans.filter((p) => p.direction === 'long').length;
    const shorts = plans.filter((p) => p.direction === 'short').length;
    const rrs = plans.map((p) => p.rr).filter(Boolean);
    const avgRr =
      rrs.length > 0 ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null;
    return { longs, shorts, avgRr };
  }, [plans]);

  const plansByTab = useMemo(() => {
    const s = (p) => p.status || 'armed';
    if (planTab === 'Active') return plans.filter((p) => !['filled', 'expired', 'cancelled', 'rejected'].includes(s(p)));
    if (planTab === 'Triggered') return plans.filter((p) => ['triggered', 'executing'].includes(s(p)));
    if (planTab === 'History') return plans.filter((p) => ['filled', 'expired', 'cancelled', 'rejected'].includes(s(p)));
    return plans;
  }, [plans, planTab]);

  const maxPlans = 10;

  const isDemoMode = apiError && !apiData;

  return (
    <section className="flex flex-col gap-6">
      {apiError && !isDemoMode && (
        <div className="card flex items-center justify-between gap-3 rounded-2xl border-rose-200 bg-rose-50 p-4 dark:border-rose-800/50 dark:bg-rose-950/30">
          <p className="text-sm text-rose-700 dark:text-rose-300">{apiError}</p>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium hover:bg-rose-100 dark:hover:bg-rose-900/30"
          >
            Dismiss
          </button>
        </div>
      )}
      {isDemoMode && (
        <div className="card flex items-center gap-3 rounded-2xl border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Demo mode — Strat Plan Lifecycle disabled. Alerts and plans are local only.
            </p>
            <p className="muted mt-0.5 text-xs">
              Enable with <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">ENABLE_STRAT_PLAN_LIFECYCLE=true</code> to sync with backend.
            </p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Zap className="h-7 w-7 text-amber-500" />
            Strat Command
          </h1>
          <p className="muted text-sm">Setups · Plans · Execution</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="muted flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
            <span>Plan capacity</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
              {plans.length}/10
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              LIVE
            </span>
          </div>
          <button
            type="button"
            onClick={loadApiData}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card overflow-hidden p-4">
          <p className="muted text-xs uppercase tracking-wider">Alerts</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="card overflow-hidden border-l-4 border-emerald-500/50 p-4">
          <p className="muted text-xs uppercase tracking-wider">Triggered</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.triggered}
          </p>
        </div>
        <div className="card overflow-hidden border-l-4 border-amber-500/50 p-4">
          <p className="muted text-xs uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {stats.pending}
          </p>
        </div>
        <div className="card overflow-hidden border-l-4 border-indigo-500/50 p-4">
          <p className="muted text-xs uppercase tracking-wider">Active Plans</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {stats.activePlans}
          </p>
        </div>
      </div>

      {/* Main layout: Alerts (2/3) + Plans (1/3) */}
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        {/* Strat Alerts Panel */}
        <div className="card overflow-hidden p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Strat Alerts</h2>
            <input
              type="text"
              value={symbolSearch}
              onChange={(e) => setSymbolSearch(e.target.value)}
              placeholder="Search symbol..."
              className="w-36 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {['all', 'triggered', 'pending', 'watching'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                  statusFilter === s
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {s}
              </button>
            ))}
            <select
              value={tfFilter}
              onChange={(e) => setTfFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">All TF</option>
              <option value="4H">4H</option>
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
            </select>
            <select
              value={dirFilter}
              onChange={(e) => setDirFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="all">All Dir</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div className="flex flex-col gap-3">
            {filteredAlerts.length === 0 ? (
              <p className="muted py-8 text-center text-sm">No alerts match filters.</p>
            ) : (
              filteredAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  expanded={expandedId === alert.id}
                  onToggle={() =>
                    setExpandedId((x) => (x === alert.id ? null : alert.id))
                  }
                  onCreatePlan={setCreateFromAlert}
                  onAlertMe={() => {}}
                  onChart={() => {}}
                />
              ))
            )}
          </div>
        </div>

        {/* Active Plans Panel */}
        <div className="card overflow-hidden p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Plans</h2>
            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 active:scale-[0.98]"
            >
              <Plus size={14} />
              Manual
            </button>
          </div>
          <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/50">
            {['Active', 'Triggered', 'History'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPlanTab(tab)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                  planTab === tab
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="mb-4">
            <div className="flex justify-between text-xs">
              <span className="muted">Capacity</span>
              <span>
                {plans.length}/{maxPlans}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(plans.length / maxPlans) * 100}%` }}
              />
            </div>
          </div>
          <div className="space-y-2">
            {plansByTab.length === 0 ? (
              <p className="muted py-4 text-center text-sm">
                {planTab === 'Active' && 'No active plans.'}
                {planTab === 'Triggered' && 'No triggered plans.'}
                {planTab === 'History' && 'No history yet.'}
              </p>
            ) : (
              plansByTab.map((plan) => (
                <div
                  key={plan.id}
                  className="group relative rounded-lg border border-slate-200 p-3 transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            plan.active ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span className="font-bold">{plan.symbol}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            plan.direction === 'long'
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {plan.direction === 'long' ? '▲' : '▼'}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-blue-600 dark:text-blue-400">
                        {plan.options || '—'}
                      </p>
                      <p className="muted mt-1 font-mono text-xs">
                        E:{plan.entry} T:{plan.target} S:{plan.stop} R:R:{plan.rr || '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePlan(plan.id)}
                      className="rounded p-1.5 text-slate-400 opacity-0 transition hover:bg-rose-100 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-900/30"
                      aria-label="Remove plan"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="muted mb-2 text-xs uppercase tracking-wider">Summary</p>
            <div className="flex justify-between text-sm">
              <span>Long: {planSummary.longs}</span>
              <span>Short: {planSummary.shorts}</span>
              <span>
                Avg R:R:{' '}
                {planSummary.avgRr != null
                  ? planSummary.avgRr.toFixed(2)
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {createFromAlert && (
        <CreatePlanFromAlertModal
          alert={createFromAlert}
          onConfirm={handleConfirmPlanFromAlert}
          onCancel={() => setCreateFromAlert(null)}
        />
      )}
      {showManualModal && (
        <CreatePlanManualModal
          onConfirm={handleConfirmPlanManual}
          onCancel={() => setShowManualModal(false)}
        />
      )}
    </section>
  );
}
