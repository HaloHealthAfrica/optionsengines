'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCcw,
  Plus,
  Trash2,
  ChevronDown,
  Zap,
  Bell,
  BarChart3,
  AlertCircle,
  X,
  Brain,
} from 'lucide-react';
import StratIntelligencePanel from './StratIntelligencePanel.js';

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

function ScoreBadge({ score, scoreCalibration }) {
  const n = Number(score) || 0;
  const cls =
    n >= 85
      ? 'bg-emerald-500/20 text-emerald-600 dark:bg-emerald-400/30 dark:text-emerald-300 border-emerald-500/40'
      : n >= 75
        ? 'bg-amber-500/20 text-amber-600 dark:bg-amber-400/30 dark:text-amber-300 border-amber-500/40'
        : 'bg-rose-500/20 text-rose-600 dark:bg-rose-400/30 dark:text-rose-300 border-rose-500/40';
  const calibrated = scoreCalibration?.isCalibrated;
  const overPredicts = scoreCalibration && scoreCalibration.actualWinRate < scoreCalibration.predictedWinRate - 0.15;
  return (
    <span
      className={`inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border px-2 font-mono text-sm font-bold ${cls}`}
      title={
        calibrated === true
          ? 'Well-calibrated in this range'
          : overPredicts
            ? `Model over-predicts — actual win rate ${((scoreCalibration?.actualWinRate ?? 0) * 100).toFixed(0)}%`
            : null
      }
    >
      {n}
      {calibrated === true && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
      {overPredicts && <span className="text-amber-600 dark:text-amber-400">⚠</span>}
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
  onDelete,
  alertContext,
}) {
  const isTriggered = alert.status === 'triggered';
  const canDelete = ['invalidated', 'expired'].includes(alert.status);
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
        <ScoreBadge score={alert.score} scoreCalibration={alertContext?.scoreCalibration} />
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
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(alert.id); }}
            className="rounded p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
            aria-label="Delete alert"
          >
            <Trash2 size={16} />
          </button>
        )}
        <ChevronDown
          size={18}
          className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700/60">
          {alertContext && (alertContext.patternStats || alertContext.symbolStats) && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/30">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Historical: {alert.setupType} on {alert.symbol} {alert.timeframe}
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                {alertContext.patternStats && (
                  <span>
                    Win rate: {((alertContext.patternStats.winRate ?? 0) * 100).toFixed(0)}% ({alertContext.patternStats.sampleSize} trades)
                  </span>
                )}
                {alertContext.patternStats && (
                  <span>
                    Avg R: {(alertContext.patternStats.avgRR ?? 0).toFixed(1)}R
                  </span>
                )}
                {alertContext.symbolStats && (
                  <span>
                    {alert.symbol} strat-friendliness: {((alertContext.symbolStats.winRate ?? 0) * 100).toFixed(0)}/100
                  </span>
                )}
                {alertContext.flowEdge != null && alertContext.flowEdge > 0.05 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Flow alignment: +{((alertContext.flowEdge ?? 0) * 100).toFixed(0)}% win rate
                  </span>
                )}
              </div>
            </div>
          )}
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
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(alert.id);
                }}
                className="flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-900/30 dark:text-rose-400"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePlanFromAlertModal({ alert, onConfirm, onCancel }) {
  const [notes, setNotes] = useState('');
  const [executionMode, setExecutionMode] = useState('auto_on_trigger');
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
          {alert.reversalLevel != null && (
            <div className="col-span-2">
              <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                Execution
              </p>
              <div className="flex gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="execMode"
                    checked={executionMode === 'auto_on_trigger'}
                    onChange={() => setExecutionMode('auto_on_trigger')}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm">Auto on trigger (price {alert.direction === 'long' ? '≥' : '≤'} ${alert.reversalLevel?.toFixed(2)})</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="execMode"
                    checked={executionMode === 'manual'}
                    onChange={() => setExecutionMode('manual')}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm">Manual</span>
                </label>
              </div>
            </div>
          )}
          <div className="col-span-2 mt-2">
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
            onClick={() => onConfirm({ ...alert, notes, executionMode })}
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

function AddAlertModal({ onConfirm, onCancel }) {
  const [form, setForm] = useState({
    symbol: '',
    direction: 'long',
    timeframe: 'D',
    setup: '2-1-2 Rev',
    entry: '',
    target: '',
    stop: '',
    reversalLevel: '',
    score: 75,
    conditionText: '',
    optionsSuggestion: '',
    alsoCreatePlan: true,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const entry = parseFloat(form.entry);
    const target = parseFloat(form.target);
    const stop = parseFloat(form.stop);
    const reversalLevel = form.reversalLevel ? parseFloat(form.reversalLevel) : undefined;
    if (!Number.isFinite(entry) || !Number.isFinite(target) || !Number.isFinite(stop)) return;
    onConfirm({
      symbol: form.symbol,
      direction: form.direction,
      timeframe: form.timeframe,
      setup: form.setup,
      entry,
      target,
      stop,
      reversalLevel,
      score: Number(form.score) || 75,
      conditionText: form.conditionText || undefined,
      optionsSuggestion: form.optionsSuggestion || undefined,
      alsoCreatePlan: form.alsoCreatePlan,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Add Alert (Manual)</h2>
          <button type="button" onClick={onCancel} className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Symbol</label>
              <input type="text" value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} placeholder="SPY" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" required />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Direction</label>
              <select value={form.direction} onChange={(e) => setForm((p) => ({ ...p, direction: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Timeframe</label>
              <select value={form.timeframe} onChange={(e) => setForm((p) => ({ ...p, timeframe: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <option value="4H">4H</option>
                <option value="D">D</option>
                <option value="W">W</option>
                <option value="M">M</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Setup</label>
              <input type="text" value={form.setup} onChange={(e) => setForm((p) => ({ ...p, setup: e.target.value }))} placeholder="2-1-2 Rev" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Entry</label>
              <input type="text" value={form.entry} onChange={(e) => setForm((p) => ({ ...p, entry: e.target.value }))} placeholder="138.50" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" required />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Target</label>
              <input type="text" value={form.target} onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))} placeholder="145.00" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" required />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Stop</label>
              <input type="text" value={form.stop} onChange={(e) => setForm((p) => ({ ...p, stop: e.target.value }))} placeholder="134.20" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" required />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Reversal Level</label>
              <input type="text" value={form.reversalLevel} onChange={(e) => setForm((p) => ({ ...p, reversalLevel: e.target.value }))} placeholder="139.10" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Score</label>
              <input type="number" min={0} max={100} value={form.score} onChange={(e) => setForm((p) => ({ ...p, score: parseInt(e.target.value, 10) || 75 }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Condition</label>
              <input type="text" value={form.conditionText} onChange={(e) => setForm((p) => ({ ...p, conditionText: e.target.value }))} placeholder="Break above X confirms" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Options Suggestion</label>
              <input type="text" value={form.optionsSuggestion} onChange={(e) => setForm((p) => ({ ...p, optionsSuggestion: e.target.value }))} placeholder="139c & 145c 2/21 Exp" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="alsoCreatePlan"
                checked={form.alsoCreatePlan}
                onChange={(e) => setForm((p) => ({ ...p, alsoCreatePlan: e.target.checked }))}
                className="rounded border-slate-300"
              />
              <label htmlFor="alsoCreatePlan" className="text-sm">
                Also create plan (auto-on-trigger) — trade when alert triggers
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="gradient-button flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.98]">Add Alert</button>
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
          </div>
        </form>
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

function mapApiAlertToUI(row) {
  const entry = Number(row.entry) || 0;
  const target = Number(row.target) || 0;
  const stop = Number(row.stop) || 0;
  const rr = entry > 0 && stop !== target ? Math.abs((target - entry) / (entry - stop)) : null;
  const rev = row.reversalLevel ?? row.reversal_level;
  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction,
    timeframe: row.timeframe,
    setupType: row.setup || row.setupType,
    score: Number(row.score) || 0,
    status: row.status || 'watching',
    timestamp: (row.triggeredAt || row.triggered_at || row.createdAt || row.created_at || new Date()).toISOString?.() ?? String(row.triggeredAt || row.createdAt || new Date()),
    entry,
    target,
    stop,
    rr,
    reversalLevel: rev != null ? Number(rev) : null,
    condition: row.conditionText || row.condition_text || row.condition,
    optionsPlay: row.optionsSuggestion || row.options_suggestion || row.optionsPlay,
    c1Shape: row.c1Shape || row.c1_shape || row.c1Shape,
    rvol: typeof row.rvol === 'number' ? row.rvol : parseFloat(String(row.rvol || '0')) || 0,
    atr: row.atr != null ? Number(row.atr) : null,
  };
}

export default function StratCommandCenter() {
  const [alerts, setAlerts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tfFilter, setTfFilter] = useState('all');
  const [dirFilter, setDirFilter] = useState('all');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [createFromAlert, setCreateFromAlert] = useState(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showAddAlertModal, setShowAddAlertModal] = useState(false);
  const [apiData, setApiData] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [planTab, setPlanTab] = useState('Active');
  const [watchlistInput, setWatchlistInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [mainTab, setMainTab] = useState('alerts'); // 'alerts' | 'intelligence'
  const [alertContext, setAlertContext] = useState(null);
  const [batchCreating, setBatchCreating] = useState(false);

  const isDemoMode = apiError && !apiData;

  const runStratScan = useCallback(async (opts = {}) => {
    setScanning(true);
    try {
      await fetch('/api/strat/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
    } catch (err) {
      console.error('Strat scan failed:', err);
    } finally {
      setScanning(false);
    }
  }, []);

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

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch('/api/strat/alerts?limit=50');
      if (r.status === 503) return;
      const json = await r.json();
      const list = json.alerts || [];
      setAlerts(list.map(mapApiAlertToUI));
    } catch (err) {
      console.error('Load alerts failed:', err);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const tabs = ['active', 'triggered', 'history'];
      const results = await Promise.all(
        tabs.map(async (tab) => {
          const r = await fetch(`/api/strat-plan/plans?tab=${tab}`);
          if (r.status === 503) return { plans: [] };
          return r.json();
        })
      );
      const allPlans = results.flatMap((r) => r.plans || []).filter(Boolean);
      setPlans(allPlans);
    } catch (err) {
      console.error('Load plans failed:', err);
    }
  }, []);

  const handleAddTicker = useCallback(async () => {
    const sym = watchlistInput.trim().toUpperCase();
    if (!sym) return;
    try {
      const res = await fetch('/api/strat-plan/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to add ticker');
      setWatchlistInput('');
      loadApiData();
      if (!isDemoMode) {
        await runStratScan({ symbols: [sym] });
        loadAlerts();
      }
    } catch (err) {
      console.error('Add ticker failed:', err);
      setApiError(err?.message);
    }
  }, [watchlistInput, loadApiData, runStratScan, loadAlerts, isDemoMode]);

  const handleRemoveTicker = useCallback(async (symbol) => {
    try {
      const res = await fetch(`/api/strat-plan/watchlist/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || 'Failed to remove ticker');
      }
      loadApiData();
    } catch (err) {
      console.error('Remove ticker failed:', err);
      setApiError(err?.message);
    }
  }, [loadApiData]);

  const wsUrl = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL
    ? process.env.NEXT_PUBLIC_WS_URL
    : 'ws://localhost:8080/v1/realtime';
  useEffect(() => {
    if (apiError && !apiData) return;
    if (!apiData) return;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (
          msg.type === 'strat_plan_update' ||
          msg.type === 'strat_alert_new' ||
          msg.type === 'strat_scan_complete' ||
          msg.type === 'strat_alert_triggered' ||
          msg.type === 'strat_alert_invalidated'
        ) {
          loadAlerts();
          loadPlans();
        }
      } catch (_) {}
    };
    return () => ws.close();
  }, [apiData, apiError, loadAlerts, loadPlans, wsUrl]);

  useEffect(() => {
    loadApiData();
  }, [loadApiData]);

  useEffect(() => {
    if (apiData && !apiError) {
      loadAlerts();
      loadPlans();
    }
  }, [apiData, apiError, loadAlerts, loadPlans]);

  useEffect(() => {
    if (!expandedId || isDemoMode) {
      setAlertContext(null);
      return;
    }
    const alert = alerts.find((a) => a.id === expandedId);
    if (!alert) {
      setAlertContext(null);
      return;
    }
    const params = new URLSearchParams({
      pattern: alert.setupType || alert.setup || '',
      symbol: alert.symbol || '',
      timeframe: alert.timeframe || '',
      score: String(alert.score || 0),
    });
    fetch(`/api/strat/analytics/alert-context?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setAlertContext(data))
      .catch(() => setAlertContext(null));
  }, [expandedId, alerts, isDemoMode]);

  const filteredAlerts = useMemo(() => {
    const source = isDemoMode ? MOCK_ALERTS : alerts;
    return source.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (tfFilter !== 'all' && a.timeframe !== tfFilter) return false;
      if (dirFilter !== 'all' && a.direction !== dirFilter) return false;
      if (symbolSearch && !a.symbol.toUpperCase().includes(symbolSearch.toUpperCase()))
        return false;
      return true;
    });
  }, [alerts, statusFilter, tfFilter, dirFilter, symbolSearch, isDemoMode]);

  const stats = useMemo(() => {
    const source = isDemoMode ? MOCK_ALERTS : alerts;
    const triggered = source.filter((a) => a.status === 'triggered').length;
    const pending = source.filter((a) => a.status === 'pending').length;
    const watching = source.filter((a) => a.status === 'watching').length;
    const activePlans = plans.filter(
      (p) => !['filled', 'expired', 'cancelled', 'rejected', 'triggered', 'executing'].includes(p.status || '')
    ).length;
    return {
      total: source.length,
      triggered,
      pending,
      watching,
      activePlans,
    };
  }, [alerts, plans, isDemoMode]);

  const maxPlans = 10;

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
    const rev = alertWithNotes.reversalLevel;
    const execMode = alertWithNotes.executionMode ?? (rev != null ? 'auto_on_trigger' : 'manual');
    const triggerCond =
      rev != null && execMode === 'auto_on_trigger'
        ? alertWithNotes.direction === 'long'
          ? `price >= ${rev}`
          : `price <= ${rev}`
        : undefined;
    const planPayload = {
      symbol: alertWithNotes.symbol,
      direction: alertWithNotes.direction,
      timeframe: alertWithNotes.timeframe === 'D' ? '1d' : alertWithNotes.timeframe === 'W' ? '1w' : '4h',
      entry: alertWithNotes.entry,
      target: alertWithNotes.target,
      stop: alertWithNotes.stop,
      reversalLevel: rev ?? undefined,
      setup: alertWithNotes.setupType,
      executionMode: execMode,
      triggerCondition: triggerCond,
      fromAlert: true,
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
      loadPlans();
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
    const entryNum = parseFloat(form.entry);
    const targetNum = parseFloat(form.target);
    const stopNum = parseFloat(form.stop);
    const planPayload = {
      symbol: form.symbol,
      direction: form.direction,
      timeframe: '1d',
      entry: Number.isFinite(entryNum) ? entryNum : undefined,
      target: Number.isFinite(targetNum) ? targetNum : undefined,
      stop: Number.isFinite(stopNum) ? stopNum : undefined,
      executionMode: 'manual',
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
      loadPlans();
    } catch (err) {
      console.error('Create plan failed:', err);
      setApiError(err?.message);
    }
    setShowManualModal(false);
    loadApiData();
  };

  const handleRemovePlan = async (id) => {
    if (isDemoMode) {
      setPlans((p) => p.filter((x) => x.id !== id));
      return;
    }
    try {
      const res = await fetch(`/api/strat-plan/plans/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to remove plan');
      setPlans((p) => p.filter((x) => x.id !== id));
      loadPlans();
    } catch (err) {
      console.error('Remove plan failed:', err);
      setApiError(err?.message);
    }
  };

  const handleDeleteAlert = useCallback(async (alertId) => {
    if (isDemoMode) return;
    try {
      const res = await fetch(`/api/strat/alerts/${alertId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json())?.error || 'Delete failed');
      setExpandedId((x) => (x === alertId ? null : x));
      loadAlerts();
    } catch (err) {
      setApiError(err?.message || 'Delete failed');
    }
  }, [isDemoMode, loadAlerts]);

  const handleCleanupInvalidated = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const res = await fetch('/api/strat/alerts/cleanup', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Cleanup failed');
      if (data.deleted > 0) {
        loadAlerts();
        setApiError(null);
      }
    } catch (err) {
      setApiError(err?.message || 'Cleanup failed');
    }
  }, [isDemoMode, loadAlerts]);

  const handleBatchCreatePlans = useCallback(async () => {
    if (isDemoMode) return;
    setBatchCreating(true);
    try {
      const res = await fetch('/api/strat-plan/plans/batch', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Batch create failed');
      if (data.created > 0) {
        loadPlans();
        loadApiData();
        setApiError(null);
      }
      if (data.failed > 0 && data.errors?.length) {
        setApiError(`${data.failed} failed: ${data.errors[0]?.reason || 'capacity'}`);
      }
    } catch (err) {
      setApiError(err?.message || 'Batch create failed');
    } finally {
      setBatchCreating(false);
    }
  }, [isDemoMode, loadPlans, loadApiData]);

  const handleConfirmAddAlert = async (form) => {
    try {
      const res = await fetch('/api/strat/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: form.symbol,
          direction: form.direction,
          timeframe: form.timeframe,
          setup: form.setup,
          entry: form.entry,
          target: form.target,
          stop: form.stop,
          reversalLevel: form.reversalLevel,
          score: form.score,
          conditionText: form.conditionText,
          optionsSuggestion: form.optionsSuggestion,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Failed to add alert');
      }
      const json = await res.json();
      setShowAddAlertModal(false);
      loadAlerts();
      if (form.alsoCreatePlan && json?.alert?.id) {
        const rev = form.reversalLevel ?? form.entry;
        const planRes = await fetch('/api/strat-plan/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: form.symbol,
            direction: form.direction,
            timeframe: form.timeframe === 'D' ? '1d' : form.timeframe === 'W' ? '1w' : form.timeframe === 'M' ? '1month' : '4h',
            entry: form.entry,
            target: form.target,
            stop: form.stop,
            reversalLevel: rev,
            setup: form.setup,
            sourceAlertId: json.alert.id,
            executionMode: 'auto_on_trigger',
            triggerCondition: form.direction === 'long' ? `price >= ${rev}` : `price <= ${rev}`,
            fromAlert: true,
          }),
        });
        if (planRes.ok) {
          loadPlans();
          loadApiData();
        }
      }
    } catch (err) {
      console.error('Add alert failed:', err);
      setApiError(err?.message);
    }
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
    const getStatus = (p) => p.status || 'armed';
    if (planTab === 'Active') return plans.filter((p) => !['filled', 'expired', 'cancelled', 'rejected'].includes(getStatus(p)));
    if (planTab === 'Triggered') return plans.filter((p) => ['triggered', 'executing'].includes(getStatus(p)));
    if (planTab === 'History') return plans.filter((p) => ['filled', 'expired', 'cancelled', 'rejected'].includes(getStatus(p)));
    return plans;
  }, [plans, planTab]);

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
              {stats.activePlans}/{maxPlans}
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
            onClick={async () => {
              loadApiData();
              if (!isDemoMode) {
                await runStratScan();
                loadAlerts();
              } else {
                loadAlerts();
              }
              loadPlans();
            }}
            disabled={scanning}
            className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-70"
          >
            <RefreshCcw size={16} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Tracked Tickers - symbols the system tracks for plans */}
      {!isDemoMode && (
        <div className="card overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Tracked Tickers
            </h2>
            <span className="muted text-xs">
              {(apiData?.watchlist?.count ?? 0)}/{(apiData?.watchlist?.max_tickers ?? 10)}
            </span>
          </div>
          <p className="muted mb-3 text-xs">
            Add up to {(apiData?.watchlist?.max_tickers ?? 10)} tickers. Plans and webhook signals are only accepted for symbols in this list.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(apiData?.watchlist?.entries ?? []).map((e) => (
              <span
                key={e.symbol}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-mono font-medium dark:border-slate-700 dark:bg-slate-800"
              >
                {e.symbol}
                <button
                  type="button"
                  onClick={() => handleRemoveTicker(e.symbol)}
                  className="rounded p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                  aria-label={`Remove ${e.symbol}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {(!apiData?.watchlist?.at_capacity) && (
              <form
                onSubmit={(ev) => { ev.preventDefault(); handleAddTicker(); }}
                className="inline-flex items-center gap-1"
              >
                <input
                  type="text"
                  value={watchlistInput}
                  onChange={(e) => setWatchlistInput(e.target.value.toUpperCase())}
                  placeholder="Add ticker..."
                  maxLength={10}
                  className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono dark:border-slate-700 dark:bg-slate-900"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  <Plus size={12} />
                  Add
                </button>
              </form>
            )}
            {(apiData?.watchlist?.entries ?? []).length === 0 && (
              <span className="muted text-xs">No tickers yet. Add symbols to start tracking.</span>
            )}
          </div>
        </div>
      )}

      {/* Main Tab: Alerts vs Intelligence */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/50">
        <button
          type="button"
          onClick={() => setMainTab('alerts')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
            mainTab === 'alerts'
              ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <AlertCircle size={16} />
          Alerts & Plans
        </button>
        <button
          type="button"
          onClick={() => setMainTab('intelligence')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
            mainTab === 'intelligence'
              ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Brain size={16} />
          Intelligence
        </button>
      </div>

      {mainTab === 'intelligence' ? (
        <StratIntelligencePanel isDemoMode={isDemoMode} />
      ) : (
        <>
      {/* Stats Bar - clickable to filter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`card overflow-hidden p-4 text-left transition hover:ring-2 hover:ring-slate-300 dark:hover:ring-slate-600 ${statusFilter === 'all' ? 'ring-2 ring-slate-400 dark:ring-slate-500' : ''}`}
        >
          <p className="muted text-xs uppercase tracking-wider">Alerts</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </button>
        <button
          type="button"
          onClick={() => { setStatusFilter('triggered'); setPlanTab('Triggered'); }}
          className={`card overflow-hidden border-l-4 border-emerald-500/50 p-4 text-left transition hover:ring-2 hover:ring-emerald-300 dark:hover:ring-emerald-600 ${statusFilter === 'triggered' ? 'ring-2 ring-emerald-400 dark:ring-emerald-500' : ''}`}
        >
          <p className="muted text-xs uppercase tracking-wider">Triggered</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.triggered}
          </p>
        </button>
        <button
          type="button"
          onClick={() => { setStatusFilter('pending'); setPlanTab('Active'); }}
          className={`card overflow-hidden border-l-4 border-amber-500/50 p-4 text-left transition hover:ring-2 hover:ring-amber-300 dark:hover:ring-amber-600 ${statusFilter === 'pending' ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
        >
          <p className="muted text-xs uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {stats.pending}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setPlanTab('Active')}
          className={`card overflow-hidden border-l-4 border-indigo-500/50 p-4 text-left transition hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-600 ${planTab === 'Active' ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : ''}`}
        >
          <p className="muted text-xs uppercase tracking-wider">Active Plans</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {stats.activePlans}
          </p>
        </button>
      </div>

      {/* Main layout: Alerts (2/3) + Plans (1/3) */}
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        {/* Strat Alerts Panel */}
        <div className="card overflow-hidden p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Strat Alerts</h2>
            <div className="flex items-center gap-2">
              {!isDemoMode && (
                <>
                  <button
                    type="button"
                    onClick={handleBatchCreatePlans}
                    disabled={batchCreating || filteredAlerts.filter((a) => ['pending', 'watching'].includes(a.status)).length === 0}
                    className="gradient-button flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50"
                    title="Create plans with auto-on-trigger for all pending alerts. When they trigger, trades go to decision engines automatically."
                  >
                    <Zap size={14} className={batchCreating ? 'animate-pulse' : ''} />
                    {batchCreating ? 'Creating...' : 'Create Plans for All'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCleanupInvalidated}
                    disabled={!filteredAlerts.some((a) => ['invalidated', 'expired'].includes(a.status))}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    title="Delete all invalidated and expired alerts"
                  >
                    <Trash2 size={14} />
                    Clean up
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddAlertModal(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <Plus size={14} />
                    Add Alert
                  </button>
                </>
              )}
              <input
              type="text"
              value={symbolSearch}
              onChange={(e) => setSymbolSearch(e.target.value)}
              placeholder="Search symbol..."
              className="w-36 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {['all', 'triggered', 'pending', 'watching', 'invalidated', 'expired'].map((s) => (
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
                  onDelete={isDemoMode ? undefined : handleDeleteAlert}
                  alertContext={expandedId === alert.id ? alertContext : null}
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
                {stats.activePlans}/{maxPlans}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(stats.activePlans / maxPlans) * 100}%` }}
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
                    <div className="flex items-center gap-1">
                      {planTab === 'Active' && ['armed', 'draft'].includes(plan.status || '') && !isDemoMode && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/strat-plan/plans/${plan.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: 'cancelled' }),
                              });
                              if (!res.ok) throw new Error((await res.json())?.error || 'Failed to cancel');
                              loadPlans();
                            } catch (err) {
                              setApiError(err?.message);
                            }
                          }}
                          className="rounded px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30"
                        >
                          Cancel
                        </button>
                      )}
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
        </>
      )}

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
      {showAddAlertModal && (
        <AddAlertModal
          onConfirm={handleConfirmAddAlert}
          onCancel={() => setShowAddAlertModal(false)}
        />
      )}
    </section>
  );
}
