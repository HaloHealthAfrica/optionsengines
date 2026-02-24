'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileJson,
  RefreshCw,
  Shield,
  XCircle,
  Settings,
} from 'lucide-react';

interface Snapshot {
  id: string;
  signal_id: string;
  decision_id: string | null;
  status: string;
  reason: string | null;
  order_plan_json: Record<string, unknown> | null;
  created_at: string;
}

const MODES = ['LEGACY_ONLY', 'SHADOW_UDC', 'UDC_PRIMARY', 'UDC_ONLY'] as const;

type StatusFilter = '' | 'NO_STRATEGY' | 'BLOCKED' | 'PLAN_CREATED';

const STATUS_COLORS: Record<string, string> = {
  PLAN_CREATED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  BLOCKED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  NO_STRATEGY: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PLAN_CREATED: <CheckCircle2 size={14} />,
  BLOCKED: <XCircle size={14} />,
  NO_STRATEGY: <AlertTriangle size={14} />,
};

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  LEGACY_ONLY: { label: 'Legacy Only', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  SHADOW_UDC: { label: 'Shadow UDC', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  UDC_PRIMARY: { label: 'UDC Primary', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  UDC_ONLY: { label: 'UDC Only', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
};

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function UDCDashboardPage() {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mode, setMode] = useState('LEGACY_ONLY');
  const [modeOpen, setModeOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const switchMode = useCallback(async (newMode: string) => {
    setSwitching(true);
    try {
      const res = await fetch('/api/udc/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setMode(data.mode ?? newMode);
      } else {
        const err = await res.json().catch(() => null);
        setError(err?.error || 'Failed to switch mode');
      }
    } catch {
      setError('Failed to switch mode');
    } finally {
      setSwitching(false);
      setModeOpen(false);
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (filter) params.set('status', filter);

      const res = await fetch(`/api/udc/snapshots?${params.toString()}`);
      if (res.status === 401) {
        router.push('/udc/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSnapshots(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, [filter, router]);

  const fetchMode = useCallback(async () => {
    try {
      const res = await fetch('/api/udc/mode');
      if (res.ok) {
        const data = await res.json();
        setMode(data.mode ?? 'LEGACY_ONLY');
      }
    } catch {
      // keep default
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
    fetchMode();
  }, [fetchSnapshots, fetchMode]);

  const stats = {
    total,
    plans: snapshots.filter((s) => s.status === 'PLAN_CREATED').length,
    blocked: snapshots.filter((s) => s.status === 'BLOCKED').length,
    noStrategy: snapshots.filter((s) => s.status === 'NO_STRATEGY').length,
  };

  const modeInfo = MODE_LABELS[mode] ?? MODE_LABELS.LEGACY_ONLY;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Unified Decision Core</h1>
            <p className="mt-1 text-sm text-slate-400">
              Shadow decision audit trail and order plan review
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Mode toggle dropdown */}
            <div className="relative">
              <button
                onClick={() => setModeOpen(!modeOpen)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-80 ${modeInfo.color}`}
              >
                <Shield size={12} />
                {switching ? 'Switching...' : modeInfo.label}
                <Settings size={10} className="ml-0.5 opacity-60" />
              </button>
              {modeOpen && (
                <div className="absolute right-0 z-10 mt-2 w-48 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
                  {MODES.map((m) => {
                    const info = MODE_LABELS[m] ?? MODE_LABELS.LEGACY_ONLY;
                    const active = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => !active && switchMode(m)}
                        disabled={active || switching}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                          active
                            ? 'bg-slate-800 font-semibold text-white'
                            : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              onClick={() => { fetchSnapshots(); fetchMode(); }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Decisions', value: stats.total, icon: <Activity size={16} />, color: 'text-slate-300' },
            { label: 'Plans Created', value: stats.plans, icon: <CheckCircle2 size={16} />, color: 'text-emerald-400' },
            { label: 'Blocked', value: stats.blocked, icon: <XCircle size={16} />, color: 'text-rose-400' },
            { label: 'No Strategy', value: stats.noStrategy, icon: <AlertTriangle size={16} />, color: 'text-slate-500' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3"
            >
              <div className={`mb-1 flex items-center gap-1.5 text-xs ${stat.color}`}>
                {stat.icon}
                {stat.label}
              </div>
              <p className="text-xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-slate-500">Filter:</span>
          {(['', 'PLAN_CREATED', 'BLOCKED', 'NO_STRATEGY'] as StatusFilter[]).map((f) => (
            <button
              key={f || 'all'}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f
                  ? 'bg-slate-100 text-slate-900 shadow-sm dark:bg-white dark:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f || 'All'}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="grid grid-cols-[1fr_100px_1fr_120px_40px] gap-2 border-b border-slate-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-slate-500">
            <span>Signal ID</span>
            <span>Status</span>
            <span>Reason</span>
            <span>Time</span>
            <span />
          </div>

          {loading && snapshots.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-500">
              <RefreshCw size={16} className="mr-2 animate-spin" />
              Loading snapshots...
            </div>
          ) : snapshots.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No decision snapshots found.
              {mode === 'LEGACY_ONLY' && (
                <span className="mt-1 block text-xs">
                  Set <code className="rounded bg-slate-800 px-1.5 py-0.5">TRADING_MODE=SHADOW_UDC</code> to start collecting.
                </span>
              )}
            </div>
          ) : (
            snapshots.map((snap) => (
              <div key={snap.id}>
                <div
                  className="grid cursor-pointer grid-cols-[1fr_100px_1fr_120px_40px] items-center gap-2 border-b border-slate-800/50 px-4 py-3 text-sm transition hover:bg-slate-800/40"
                  onClick={() => setExpandedId(expandedId === snap.id ? null : snap.id)}
                >
                  <span className="truncate font-mono text-xs text-slate-300">
                    {snap.signal_id}
                  </span>
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[snap.status] ?? STATUS_COLORS.NO_STRATEGY
                    }`}
                  >
                    {STATUS_ICONS[snap.status]}
                    {snap.status.replace('_', ' ')}
                  </span>
                  <span className="truncate text-xs text-slate-400">
                    {snap.reason ?? '—'}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock size={12} />
                    {timeAgo(snap.created_at)}
                  </span>
                  <span className="flex justify-end">
                    <ChevronDown
                      size={14}
                      className={`text-slate-500 transition ${
                        expandedId === snap.id ? 'rotate-180' : ''
                      }`}
                    />
                  </span>
                </div>

                {expandedId === snap.id && (
                  <div className="animate-fade-in border-b border-slate-800/50 bg-slate-950/40 px-4 py-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
                      <FileJson size={14} />
                      Order Plan Preview
                    </div>
                    {snap.order_plan_json ? (
                      <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-300">
                        {JSON.stringify(snap.order_plan_json, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs text-slate-500">No order plan generated.</p>
                    )}
                    <div className="mt-3 space-y-1 text-xs text-slate-500">
                      <div>
                        Snapshot ID: <span className="font-mono">{snap.id}</span>
                        <span className="mx-2">|</span>
                        Created: {new Date(snap.created_at).toLocaleString()}
                      </div>
                      {snap.decision_id && (
                        <div>
                          Decision ID: <span className="font-mono">{snap.decision_id}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {snapshots.length} of {total} snapshots
          </span>
          <span>
            Mode: <code className="rounded bg-slate-800 px-1.5 py-0.5">{mode}</code>
          </span>
        </div>
      </div>
    </div>
  );
}
