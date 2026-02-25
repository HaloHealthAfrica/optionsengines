'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  FileJson,
  Info,
  Layers,
  Moon,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
  Pencil,
} from 'lucide-react';

interface OptionLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: 'CALL' | 'PUT';
  side: 'BUY' | 'SELL';
  quantity: number;
}

interface ParsedOrderPlan {
  planId?: string;
  symbol?: string;
  structure?: string;
  legs: OptionLeg[];
  risk?: { maxLoss?: number };
}

interface TradeIntent {
  strategy: string;
  symbol: string;
  direction: 'BULL' | 'BEAR';
  structure: string;
  invalidation: number;
  dteMin: number;
  dteMax: number;
  confidence: number;
}

interface ParsedStrategy {
  intent: TradeIntent;
  confidence: number;
}

interface TradeLevelEdits {
  entry_price_low: string;
  entry_price_high: string;
  exit_price_partial: string;
  exit_price_full: string;
  invalidation_price: string;
  option_stop_pct: string;
}

interface Snapshot {
  id: string;
  signal_id: string;
  decision_id: string | null;
  status: string;
  reason: string | null;
  order_plan_json: Record<string, unknown> | null;
  strategy_json: Record<string, unknown> | null;
  entry_price_low: number | null;
  entry_price_high: number | null;
  exit_price_partial: number | null;
  exit_price_full: number | null;
  invalidation_price: number | null;
  option_stop_pct: number | null;
  created_at: string;
}

function parseOrderPlan(json: Record<string, unknown> | null): ParsedOrderPlan | null {
  if (!json) return null;
  const legs = (Array.isArray(json.legs) ? json.legs : []) as OptionLeg[];
  return {
    planId: json.planId as string | undefined,
    symbol: json.symbol as string | undefined,
    structure: json.structure as string | undefined,
    legs,
    risk: json.risk as { maxLoss?: number } | undefined,
  };
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatStrike(strike: number | string): string {
  const n = Number(strike);
  if (!Number.isFinite(n)) return String(strike);
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatExpiry(expiry: string): string {
  const d = new Date(expiry + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function daysUntilExpiry(expiry: string): number {
  const d = new Date(expiry + 'T00:00:00');
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

function structureLabel(structure: string): string {
  return structure.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseStrategy(json: Record<string, unknown> | null): ParsedStrategy | null {
  if (!json) return null;
  const intent = json.intent as Record<string, unknown> | undefined;
  if (!intent) return null;
  return {
    intent: {
      strategy: (intent.strategy as string) ?? '',
      symbol: (intent.symbol as string) ?? '',
      direction: (intent.direction as 'BULL' | 'BEAR') ?? 'BULL',
      structure: (intent.structure as string) ?? '',
      invalidation: (intent.invalidation as number) ?? 0,
      dteMin: (intent.dteMin as number) ?? 0,
      dteMax: (intent.dteMax as number) ?? 0,
      confidence: (intent.confidence as number) ?? 0,
    },
    confidence: (json.confidence as number) ?? 0,
  };
}

function inferDirection(legs: OptionLeg[], strategy: ParsedStrategy | null): 'BULL' | 'BEAR' | null {
  if (strategy?.intent.direction) return strategy.intent.direction;
  if (legs.length === 0) return null;
  const buyLeg = legs.find((l) => l.side === 'BUY');
  if (!buyLeg) return null;
  return buyLeg.type === 'CALL' ? 'BULL' : 'BEAR';
}

function strategyName(name: string): string {
  const map: Record<string, string> = {
    FAILED_2: 'Failed 2',
    ORB: 'Opening Range Breakout',
    MOMENTUM: 'Momentum',
    REVERSAL: 'Reversal',
    STRAT: 'STRAT',
    SATYLAND: 'Satyland',
  };
  return map[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const MODES = ['LEGACY_ONLY', 'SHADOW_UDC', 'UDC_PRIMARY', 'UDC_ONLY'] as const;

type StatusFilter = '' | 'NO_STRATEGY' | 'BLOCKED' | 'PLAN_CREATED';

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
  description: string;
}> = {
  PLAN_CREATED: {
    label: 'Plan Created',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30',
    icon: <CheckCircle2 size={14} />,
    description: 'Order plan was generated and is ready for execution',
  },
  BLOCKED: {
    label: 'Blocked',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30',
    icon: <XCircle size={14} />,
    description: 'Signal was blocked by risk governance rules',
  },
  NO_STRATEGY: {
    label: 'No Strategy',
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 border-slate-200 dark:bg-slate-500/10 dark:border-slate-500/30',
    icon: <AlertTriangle size={14} />,
    description: 'No matching strategy found for this signal',
  },
};

const MODE_CONFIG: Record<string, {
  label: string;
  description: string;
  color: string;
  badgeColor: string;
  icon: React.ReactNode;
  step: number;
}> = {
  LEGACY_ONLY: {
    label: 'Legacy Only',
    description: 'Only the legacy engine processes signals. UDC is off.',
    color: 'border-slate-300 dark:border-slate-600',
    badgeColor: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    icon: <ShieldOff size={16} />,
    step: 0,
  },
  SHADOW_UDC: {
    label: 'Shadow Mode',
    description: 'UDC runs in parallel but does not execute. Decisions are logged for review.',
    color: 'border-amber-400 dark:border-amber-500',
    badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    icon: <Shield size={16} />,
    step: 1,
  },
  UDC_PRIMARY: {
    label: 'UDC Primary',
    description: 'UDC is the primary decision engine. Executes via paper orders.',
    color: 'border-emerald-400 dark:border-emerald-500',
    badgeColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    icon: <ShieldCheck size={16} />,
    step: 2,
  },
  UDC_ONLY: {
    label: 'UDC Only',
    description: 'Full UDC control. Legacy engine is disabled.',
    color: 'border-cyan-400 dark:border-cyan-500',
    badgeColor: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
    icon: <Zap size={16} />,
    step: 3,
  },
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

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group flex items-center justify-between rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-700/50 dark:bg-slate-900/50">
      <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 pl-2">
        <span className="truncate font-mono text-slate-700 dark:text-slate-300" title={value}>
          {value}
        </span>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition hover:text-slate-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:text-slate-400"
          title="Copy to clipboard"
        >
          {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
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
  const [switching, setSwitching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [editingLevelsId, setEditingLevelsId] = useState<string | null>(null);
  const [levelEdits, setLevelEdits] = useState<TradeLevelEdits>({
    entry_price_low: '', entry_price_high: '',
    exit_price_partial: '', exit_price_full: '',
    invalidation_price: '', option_stop_pct: '',
  });
  const [savingLevels, setSavingLevels] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('oa-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    window.localStorage.setItem('oa-theme', theme);
  }, [theme]);

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
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (filter) params.set('status', filter);
      const res = await fetch(`/api/udc/snapshots?${params.toString()}`);
      if (res.status === 401) { router.push('/udc/login'); return; }
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSnapshots(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load snapshots';
      setError(message);
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
    } catch { /* keep default */ }
  }, []);

  useEffect(() => {
    fetchSnapshots();
    fetchMode();
  }, [fetchSnapshots, fetchMode]);

  const startEditingLevels = useCallback((snap: Snapshot) => {
    setEditingLevelsId(snap.id);
    setLevelEdits({
      entry_price_low: snap.entry_price_low?.toString() ?? '',
      entry_price_high: snap.entry_price_high?.toString() ?? '',
      exit_price_partial: snap.exit_price_partial?.toString() ?? '',
      exit_price_full: snap.exit_price_full?.toString() ?? '',
      invalidation_price: snap.invalidation_price?.toString() ?? '',
      option_stop_pct: (snap.option_stop_pct ?? 50).toString(),
    });
  }, []);

  const saveTradeLevels = useCallback(async (snapId: string) => {
    setSavingLevels(true);
    try {
      const body: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(levelEdits)) {
        body[key] = val === '' ? null : Number(val);
      }
      const res = await fetch(`/api/udc/snapshots/${snapId}/trade-levels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json();
      setSnapshots(prev => prev.map(s =>
        s.id === snapId ? { ...s, ...saved } : s,
      ));
      setEditingLevelsId(null);
    } catch {
      setError('Failed to save trade levels');
    } finally {
      setSavingLevels(false);
    }
  }, [levelEdits]);

  const stats = {
    total,
    plans: snapshots.filter((s) => s.status === 'PLAN_CREATED').length,
    blocked: snapshots.filter((s) => s.status === 'BLOCKED').length,
    noStrategy: snapshots.filter((s) => s.status === 'NO_STRATEGY').length,
  };

  const planRate = stats.total > 0 ? Math.round((stats.plans / stats.total) * 100) : 0;
  const blockRate = stats.total > 0 ? Math.round((stats.blocked / stats.total) * 100) : 0;

  const filteredSnapshots = snapshots.filter((s) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const plan = parseOrderPlan(s.order_plan_json);
    const strat = parseStrategy(s.strategy_json);
    return (
      s.signal_id.toLowerCase().includes(term) ||
      s.status.toLowerCase().includes(term) ||
      (s.reason && s.reason.toLowerCase().includes(term)) ||
      (s.decision_id && s.decision_id.toLowerCase().includes(term)) ||
      (plan?.symbol && plan.symbol.toLowerCase().includes(term)) ||
      (plan?.structure && plan.structure.toLowerCase().includes(term)) ||
      (strat?.intent.strategy && strat.intent.strategy.toLowerCase().includes(term))
    );
  });

  const modeInfo = MODE_CONFIG[mode] ?? MODE_CONFIG.LEGACY_ONLY;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 transition-colors duration-300">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Top Bar */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-cyan-500 to-brand-600 shadow-md">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Decision Core</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Unified decision engine audit trail</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => { fetchSnapshots(); fetchMode(); }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-500 via-cyan-500 to-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:shadow-lg hover:-translate-y-0.5"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Mode Selector - Pipeline Visualization */}
        <div className="card mb-6 overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Trading Mode</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Controls how signals are routed between legacy and UDC engines
              </p>
            </div>
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${modeInfo.badgeColor}`}>
              {modeInfo.icon}
              {switching ? 'Switching...' : modeInfo.label}
            </div>
          </div>

          <div className="relative">
            {/* Progress track */}
            <div className="absolute left-0 right-0 top-5 z-0 mx-auto h-0.5 w-[calc(100%-80px)] bg-slate-200 dark:bg-slate-700" style={{ left: '40px', right: '40px', width: 'calc(100% - 80px)' }}>
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-cyan-500 transition-all duration-500"
                style={{ width: `${(modeInfo.step / 3) * 100}%` }}
              />
            </div>

            <div className="relative z-10 grid grid-cols-4 gap-2">
              {MODES.map((m) => {
                const config = MODE_CONFIG[m];
                const isActive = mode === m;
                const isPast = config.step < modeInfo.step;
                return (
                  <button
                    key={m}
                    onClick={() => !isActive && !switching && switchMode(m)}
                    disabled={isActive || switching}
                    className="group flex flex-col items-center gap-2 text-center"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                        isActive
                          ? 'border-brand-500 bg-brand-500 text-white shadow-md shadow-brand-500/30 dark:border-brand-400 dark:bg-brand-500'
                          : isPast
                            ? 'border-brand-300 bg-brand-50 text-brand-500 dark:border-brand-500/50 dark:bg-brand-500/20 dark:text-brand-400'
                            : 'border-slate-200 bg-white text-slate-400 group-hover:border-slate-300 group-hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500 dark:group-hover:border-slate-500'
                      }`}
                    >
                      {config.icon}
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {config.label}
                      </p>
                      <p className="mt-0.5 hidden text-[10px] text-slate-400 dark:text-slate-500 sm:block">
                        {m === 'LEGACY_ONLY' ? 'UDC off' : m === 'SHADOW_UDC' ? 'Log only' : m === 'UDC_PRIMARY' ? 'Paper trade' : 'Full control'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active mode description */}
          <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 ${modeInfo.badgeColor} border-current/10`}>
            <Info size={14} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">{modeInfo.description}</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                <Activity size={16} className="text-slate-600 dark:text-slate-300" />
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Total</span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Total decisions processed</p>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{planRate}%</span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{stats.plans}</p>
            <div className="mt-2">
              <div className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${planRate}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Plans created</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-500/10">
                <XCircle size={16} className="text-rose-600 dark:text-rose-400" />
              </div>
              <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">{blockRate}%</span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{stats.blocked}</p>
            <div className="mt-2">
              <div className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-rose-500 transition-all duration-500" style={{ width: `${blockRate}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Blocked by risk rules</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                <AlertTriangle size={16} className="text-slate-500 dark:text-slate-400" />
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                {stats.total > 0 ? `${Math.round((stats.noStrategy / stats.total) * 100)}%` : '0%'}
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{stats.noStrategy}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No matching strategy</p>
          </div>
        </div>

        {/* Decision Log */}
        <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60">
          {/* Table Header */}
          <div className="flex flex-col gap-3 border-b border-slate-200/70 p-4 dark:border-slate-800/80 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Decision Log</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Every signal processed by the UDC is logged here with its outcome
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search signals..."
                  className="h-8 w-44 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none transition focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:placeholder-slate-500 dark:focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200/70 px-4 py-2 dark:border-slate-800/80">
            {([
              { key: '' as StatusFilter, label: 'All', count: stats.total },
              { key: 'PLAN_CREATED' as StatusFilter, label: 'Plans', count: stats.plans },
              { key: 'BLOCKED' as StatusFilter, label: 'Blocked', count: stats.blocked },
              { key: 'NO_STRATEGY' as StatusFilter, label: 'No Strategy', count: stats.noStrategy },
            ]).map((f) => (
              <button
                key={f.key || 'all'}
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.key
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  filter === f.key
                    ? 'bg-white/20 dark:bg-slate-900/20'
                    : 'bg-slate-200/60 dark:bg-slate-700/60'
                }`}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* Table Content */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {/* Loading State */}
            {loading && snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <RefreshCw size={20} className="mb-3 animate-spin text-brand-500" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading decisions...</p>
                <p className="mt-1 text-xs text-slate-400">Fetching the latest snapshots from the decision engine</p>
              </div>
            ) : filteredSnapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                  <FileJson size={24} className="text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No decisions found</p>
                {searchTerm ? (
                  <p className="mt-1 text-xs text-slate-400">Try adjusting your search or filter criteria</p>
                ) : mode === 'LEGACY_ONLY' ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Switch to <strong>Shadow Mode</strong> to start collecting UDC decisions alongside your legacy engine.
                    </p>
                    <button
                      onClick={() => switchMode('SHADOW_UDC')}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
                    >
                      Enable Shadow Mode <ArrowRight size={12} />
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    Decisions will appear here when signals are processed by the UDC
                  </p>
                )}
              </div>
            ) : (
              filteredSnapshots.map((snap) => {
                const statusCfg = STATUS_CONFIG[snap.status] ?? STATUS_CONFIG.NO_STRATEGY;
                const isExpanded = expandedId === snap.id;
                const plan = parseOrderPlan(snap.order_plan_json);
                const strategy = parseStrategy(snap.strategy_json);
                const direction = inferDirection(plan?.legs ?? [], strategy);
                const firstLeg = plan?.legs[0];
                const dte = firstLeg ? daysUntilExpiry(firstLeg.expiry) : null;

                const isEditingLevels = editingLevelsId === snap.id;
                const toNum = (v: string | number | null | undefined): number | null => {
                  if (v == null || v === '') return null;
                  const n = Number(v);
                  return Number.isFinite(n) ? n : null;
                };
                const entryLow = toNum(isEditingLevels ? levelEdits.entry_price_low : snap.entry_price_low);
                const exitFull = toNum(isEditingLevels ? levelEdits.exit_price_full : snap.exit_price_full);
                const invPrice = toNum(isEditingLevels ? levelEdits.invalidation_price : snap.invalidation_price);
                const reward = entryLow != null && exitFull != null ? exitFull - entryLow : null;
                const risk = entryLow != null && invPrice != null ? entryLow - invPrice : null;
                const rrRatio = risk != null && reward != null && risk > 0 && reward > 0 ? (reward / risk).toFixed(1) : '—';

                return (
                  <div key={snap.id}>
                    <button
                      type="button"
                      className="w-full cursor-pointer px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      onClick={() => setExpandedId(isExpanded ? null : snap.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* Left: Primary info */}
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          {/* Direction / Status indicator */}
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                            snap.status === 'PLAN_CREATED'
                              ? direction === 'BULL'
                                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                                : 'bg-rose-50 dark:bg-rose-500/10'
                              : snap.status === 'BLOCKED'
                                ? 'bg-rose-50 dark:bg-rose-500/10'
                                : 'bg-slate-100 dark:bg-slate-800'
                          }`}>
                            {snap.status === 'PLAN_CREATED' ? (
                              direction === 'BULL'
                                ? <TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" />
                                : <TrendingDown size={16} className="text-rose-600 dark:text-rose-400" />
                            ) : snap.status === 'BLOCKED' ? (
                              <XCircle size={16} className="text-rose-500 dark:text-rose-400" />
                            ) : (
                              <AlertTriangle size={16} className="text-slate-400" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Top line: Symbol + Strategy + Structure + Status */}
                            <div className="flex flex-wrap items-center gap-2">
                              {plan?.symbol ? (
                                <span className="text-sm font-bold text-slate-900 dark:text-white">
                                  {plan.symbol}
                                </span>
                              ) : (
                                <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                                  Signal
                                </span>
                              )}

                              {strategy && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                                  <Zap size={10} />
                                  {strategyName(strategy.intent.strategy)}
                                </span>
                              )}

                              {plan?.structure && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                                  <Layers size={10} />
                                  {structureLabel(plan.structure)}
                                </span>
                              )}

                              {direction && (
                                <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                  direction === 'BULL'
                                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                                    : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                                }`}>
                                  {direction === 'BULL' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                                  {direction === 'BULL' ? 'Bullish' : 'Bearish'}
                                </span>
                              )}

                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                                {statusCfg.icon}
                                {statusCfg.label}
                              </span>
                            </div>

                            {/* Second line: Trade summary or reason */}
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                              {plan && plan.legs.length > 0 ? (
                                <>
                                  {/* Legs summary */}
                                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                                    <Target size={11} className="text-slate-400" />
                                    {plan.legs.map((leg, i) => (
                                      <span key={i} className="inline-flex items-center gap-0.5">
                                        {i > 0 && <span className="mx-0.5 text-slate-300 dark:text-slate-600">/</span>}
                                        <span className={`font-semibold ${leg.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                          {leg.side}
                                        </span>
                                        <span className="text-slate-500 dark:text-slate-400">
                                          {formatStrike(leg.strike)} {leg.type}
                                        </span>
                                      </span>
                                    ))}
                                  </span>

                                  {/* Expiry */}
                                  {firstLeg && (
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                      <Clock size={11} />
                                      {formatExpiry(firstLeg.expiry)}
                                      {dte !== null && (
                                        <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                                          dte <= 3
                                            ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                                            : dte <= 7
                                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                        }`}>
                                          {dte}d
                                        </span>
                                      )}
                                    </span>
                                  )}

                                  {/* Risk / Max Loss */}
                                  {plan.risk?.maxLoss != null && (
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                      <DollarSign size={11} />
                                      Max risk {formatCurrency(plan.risk.maxLoss)}
                                    </span>
                                  )}

                                  {/* Quantity */}
                                  {firstLeg && firstLeg.quantity > 0 && (
                                    <span className="text-xs text-slate-400 dark:text-slate-500">
                                      x{firstLeg.quantity}
                                    </span>
                                  )}
                                </>
                              ) : snap.reason ? (
                                <span className="text-xs text-slate-500 dark:text-slate-400">{snap.reason}</span>
                              ) : (
                                <span className="text-xs text-slate-400 dark:text-slate-500">{statusCfg.description}</span>
                              )}
                            </div>

                            {/* Third line: IDs + Time */}
                            <div className="mt-1.5 flex items-center gap-3">
                              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500" title={snap.signal_id}>
                                sig:{shortId(snap.signal_id)}
                              </span>
                              {snap.decision_id && (
                                <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500" title={snap.decision_id}>
                                  dec:{shortId(snap.decision_id)}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 dark:text-slate-500" title={new Date(snap.created_at).toLocaleString()}>
                                {timeAgo(snap.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Expand chevron */}
                        <div className="mt-1 shrink-0">
                          {isExpanded ? (
                            <ChevronDown size={16} className="text-slate-400 dark:text-slate-500" />
                          ) : (
                            <ChevronRight size={16} className="text-slate-300 dark:text-slate-600" />
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <div className="animate-fade-in border-t border-slate-100 bg-slate-50/50 px-4 py-5 dark:border-slate-800/60 dark:bg-slate-950/30">
                        <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
                          {/* Left column: Metadata */}
                          <div className="space-y-4">
                            <div>
                              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Identifiers</h4>
                              <div className="space-y-1.5 text-xs">
                                <CopyableField label="Snapshot ID" value={snap.id} />
                                <CopyableField label="Signal ID" value={snap.signal_id} />
                                {snap.decision_id && <CopyableField label="Decision ID" value={snap.decision_id} />}
                              </div>
                            </div>

                            <div>
                              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Decision Info</h4>
                              <div className="space-y-1.5 text-xs">
                                <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-700/50 dark:bg-slate-900/50">
                                  <span className="text-slate-500 dark:text-slate-400">Status</span>
                                  <span className={`inline-flex items-center gap-1 font-medium ${statusCfg.color}`}>
                                    {statusCfg.icon} {statusCfg.label}
                                  </span>
                                </div>
                                <div className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-700/50 dark:bg-slate-900/50">
                                  <span className="text-slate-500 dark:text-slate-400">Outcome</span>
                                  <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                                    {snap.reason || statusCfg.description}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-700/50 dark:bg-slate-900/50">
                                  <span className="text-slate-500 dark:text-slate-400">Created</span>
                                  <span className="text-slate-700 dark:text-slate-300">
                                    {new Date(snap.created_at).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {strategy && (
                              <div>
                                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Strategy</h4>
                                <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
                                  <div className="flex items-center gap-2">
                                    <Zap size={14} className="text-amber-600 dark:text-amber-400" />
                                    <span className="text-sm font-bold text-amber-800 dark:text-amber-300">
                                      {strategyName(strategy.intent.strategy)}
                                    </span>
                                  </div>
                                  <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-xs">
                                    <div className="flex items-center justify-between rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-slate-900/50">
                                      <span className="text-slate-500 dark:text-slate-400">Direction</span>
                                      <span className={`font-semibold ${
                                        strategy.intent.direction === 'BULL'
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-rose-600 dark:text-rose-400'
                                      }`}>
                                        {strategy.intent.direction}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-slate-900/50">
                                      <span className="text-slate-500 dark:text-slate-400">Confidence</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                                        {Math.round(strategy.confidence * 100)}%
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-slate-900/50">
                                      <span className="text-slate-500 dark:text-slate-400">Structure</span>
                                      <span className="font-medium text-slate-700 dark:text-slate-300">
                                        {structureLabel(strategy.intent.structure)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-slate-900/50">
                                      <span className="text-slate-500 dark:text-slate-400">DTE Range</span>
                                      <span className="font-medium text-slate-700 dark:text-slate-300">
                                        {strategy.intent.dteMin}–{strategy.intent.dteMax}d
                                      </span>
                                    </div>
                                    {strategy.intent.invalidation > 0 && (
                                      <div className="col-span-2 flex items-center justify-between rounded-md bg-white/80 px-2.5 py-1.5 dark:bg-slate-900/50">
                                        <span className="text-slate-500 dark:text-slate-400">Invalidation</span>
                                        <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                                          ${formatStrike(strategy.intent.invalidation)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Right column: Order Plan */}
                          <div>
                            <div className="mb-2 flex items-center gap-1.5">
                              <FileJson size={12} className="text-slate-400" />
                              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Order Plan</h4>
                            </div>
                            {plan && plan.legs.length > 0 ? (
                              <div className="space-y-3">
                                {/* Plan header */}
                                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-white px-4 py-3 dark:border-slate-700/50 dark:bg-slate-900/50">
                                  <span className="text-base font-bold text-slate-900 dark:text-white">{plan.symbol}</span>
                                  {plan.structure && (
                                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                                      {structureLabel(plan.structure)}
                                    </span>
                                  )}
                                  {direction && (
                                    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                                      direction === 'BULL'
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                                        : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
                                    }`}>
                                      {direction === 'BULL' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                      {direction}
                                    </span>
                                  )}
                                  {plan.risk?.maxLoss != null && (
                                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                                      <DollarSign size={12} />
                                      Max Risk: <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(plan.risk.maxLoss)}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Legs table */}
                                <div className="overflow-hidden rounded-xl border border-slate-200/70 dark:border-slate-700/50">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200/70 bg-slate-100/80 dark:border-slate-700/50 dark:bg-slate-800/50">
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Side</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Type</th>
                                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Strike</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Expiry</th>
                                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">DTE</th>
                                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Qty</th>
                                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contract</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                      {plan.legs.map((leg, i) => {
                                        const legDte = daysUntilExpiry(leg.expiry);
                                        return (
                                          <tr key={i} className="bg-white dark:bg-slate-900/50">
                                            <td className="px-3 py-2.5">
                                              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                                leg.side === 'BUY'
                                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                                                  : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400'
                                              }`}>
                                                {leg.side === 'BUY' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                                                {leg.side}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2.5">
                                              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                                                leg.type === 'CALL'
                                                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400'
                                                  : 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400'
                                              }`}>
                                                {leg.type}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                              ${formatStrike(leg.strike)}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                                              {formatExpiry(leg.expiry)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                                legDte <= 3
                                                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                                                  : legDte <= 7
                                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                              }`}>
                                                {legDte}d
                                              </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-300">
                                              {leg.quantity}
                                            </td>
                                            <td className="px-3 py-2.5">
                                              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500" title={leg.symbol}>
                                                {shortId(leg.symbol)}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {plan.planId && (
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                                    <span>Plan ID:</span>
                                    <span className="font-mono">{plan.planId}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/30">
                                <div className="text-center">
                                  <FileJson size={20} className="mx-auto mb-1.5 text-slate-300 dark:text-slate-600" />
                                  <p className="text-xs font-medium text-slate-400">No order plan generated</p>
                                  <p className="mt-0.5 text-[10px] text-slate-300 dark:text-slate-600">
                                    {snap.status === 'BLOCKED' ? 'Blocked by risk governance' : 'No strategy matched this signal'}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {(strategy || plan) && (
                          <div className="mt-5">
                            <div className="mb-3 flex items-center gap-2">
                              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Trade Levels</h4>
                              {isEditingLevels ? (
                                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => saveTradeLevels(snap.id)}
                                    disabled={savingLevels}
                                    className="rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                                  >
                                    {savingLevels ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditingLevelsId(null)}
                                    className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); startEditingLevels(snap); }}
                                  className="rounded p-0.5 text-slate-300 transition hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
                                  title="Edit trade levels"
                                >
                                  <Pencil size={10} />
                                </button>
                              )}
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                              {/* Entry Card */}
                              <div className="rounded-xl border border-blue-200/70 bg-blue-50/30 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
                                <div className="flex items-center gap-1.5">
                                  <Target size={12} className="text-blue-500 dark:text-blue-400" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                                    Entry Price
                                  </span>
                                </div>
                                {isEditingLevels ? (
                                  <div className="mt-1.5 flex items-baseline gap-1" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-blue-400 dark:text-blue-500">$</span>
                                    <input
                                      type="text"
                                      value={levelEdits.entry_price_low}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, entry_price_low: e.target.value }))}
                                      placeholder="Low"
                                      className="w-14 rounded bg-white px-1 text-sm font-bold text-blue-700 outline-none ring-1 ring-blue-300 focus:ring-blue-500 dark:bg-slate-800 dark:text-blue-300 dark:ring-blue-600"
                                    />
                                    <span className="text-sm text-blue-300 dark:text-blue-600">–</span>
                                    <span className="text-sm text-blue-400 dark:text-blue-500">$</span>
                                    <input
                                      type="text"
                                      value={levelEdits.entry_price_high}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, entry_price_high: e.target.value }))}
                                      placeholder="High"
                                      className="w-14 rounded bg-white px-1 text-sm font-bold text-blue-700 outline-none ring-1 ring-blue-300 focus:ring-blue-500 dark:bg-slate-800 dark:text-blue-300 dark:ring-blue-600"
                                    />
                                  </div>
                                ) : (
                                  <p className={`mt-1.5 text-sm font-bold ${snap.entry_price_low != null ? 'text-blue-700 dark:text-blue-300' : 'text-slate-300 dark:text-slate-600'}`}>
                                    {snap.entry_price_low != null
                                      ? `$${formatStrike(snap.entry_price_low)}${snap.entry_price_high != null ? ` – $${formatStrike(snap.entry_price_high)}` : ''}`
                                      : '—'}
                                  </p>
                                )}
                              </div>

                              {/* Exit Card */}
                              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                                <div className="flex items-center gap-1.5">
                                  <TrendingUp size={12} className="text-emerald-500 dark:text-emerald-400" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500 dark:text-emerald-400">
                                    Exit Price
                                  </span>
                                </div>
                                {isEditingLevels ? (
                                  <div className="mt-1.5 flex items-baseline gap-1" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-emerald-400 dark:text-emerald-500">$</span>
                                    <input
                                      type="text"
                                      value={levelEdits.exit_price_partial}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, exit_price_partial: e.target.value }))}
                                      placeholder="Partial"
                                      className="w-14 rounded bg-white px-1 text-sm font-bold text-emerald-700 outline-none ring-1 ring-emerald-300 focus:ring-emerald-500 dark:bg-slate-800 dark:text-emerald-300 dark:ring-emerald-600"
                                    />
                                    <span className="text-sm text-emerald-300 dark:text-emerald-600">–</span>
                                    <span className="text-sm text-emerald-400 dark:text-emerald-500">$</span>
                                    <input
                                      type="text"
                                      value={levelEdits.exit_price_full}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, exit_price_full: e.target.value }))}
                                      placeholder="Full"
                                      className="w-14 rounded bg-white px-1 text-sm font-bold text-emerald-700 outline-none ring-1 ring-emerald-300 focus:ring-emerald-500 dark:bg-slate-800 dark:text-emerald-300 dark:ring-emerald-600"
                                    />
                                  </div>
                                ) : (
                                  <p className={`mt-1.5 text-sm font-bold ${snap.exit_price_partial != null ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-300 dark:text-slate-600'}`}>
                                    {snap.exit_price_partial != null
                                      ? `$${formatStrike(snap.exit_price_partial)}${snap.exit_price_full != null ? ` – $${formatStrike(snap.exit_price_full)}` : ''}`
                                      : '—'}
                                  </p>
                                )}
                              </div>

                              {/* Invalidation Card */}
                              <div className="rounded-xl border border-rose-200/70 bg-rose-50/30 p-3 dark:border-rose-500/20 dark:bg-rose-500/5">
                                <div className="flex items-center gap-1.5">
                                  <XCircle size={12} className="text-rose-500 dark:text-rose-400" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-500 dark:text-rose-400">
                                    Invalidation Price
                                  </span>
                                </div>
                                {isEditingLevels ? (
                                  <div className="mt-1.5 flex items-baseline gap-1" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-sm text-rose-400 dark:text-rose-500">$</span>
                                    <input
                                      type="text"
                                      value={levelEdits.invalidation_price}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, invalidation_price: e.target.value }))}
                                      placeholder="Stop"
                                      className="w-16 rounded bg-white px-1 text-sm font-bold text-rose-700 outline-none ring-1 ring-rose-300 focus:ring-rose-500 dark:bg-slate-800 dark:text-rose-300 dark:ring-rose-600"
                                    />
                                  </div>
                                ) : (
                                  <p className={`mt-1.5 text-sm font-bold ${snap.invalidation_price != null ? 'text-rose-700 dark:text-rose-300' : 'text-slate-300 dark:text-slate-600'}`}>
                                    {snap.invalidation_price != null ? `$${formatStrike(snap.invalidation_price)}` : '—'}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Bottom Row: Option Stop + Risk/Reward */}
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div className="flex items-center justify-between rounded-xl border border-amber-200/70 bg-amber-50/30 px-4 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/5">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500 dark:text-amber-400">
                                  Option Stop
                                </span>
                                {isEditingLevels ? (
                                  <div className="flex items-baseline gap-1" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-xs text-amber-400 dark:text-amber-500">−</span>
                                    <input
                                      type="text"
                                      value={levelEdits.option_stop_pct}
                                      onChange={(e) => setLevelEdits(p => ({ ...p, option_stop_pct: e.target.value }))}
                                      className="w-10 rounded bg-white px-1 text-right text-sm font-bold text-amber-700 outline-none ring-1 ring-amber-300 focus:ring-amber-500 dark:bg-slate-800 dark:text-amber-300 dark:ring-amber-600"
                                    />
                                    <span className="text-xs font-medium text-amber-500 dark:text-amber-400">% of premium</span>
                                  </div>
                                ) : (
                                  <span className={`text-sm font-bold ${snap.option_stop_pct != null ? 'text-amber-700 dark:text-amber-300' : 'text-slate-300 dark:text-slate-600'}`}>
                                    {snap.option_stop_pct != null ? `−${snap.option_stop_pct}% of premium` : '—'}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white px-4 py-2.5 dark:border-slate-700/50 dark:bg-slate-900/50">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Risk / Reward
                                </span>
                                <span className={`text-sm font-bold ${
                                  rrRatio !== '—' && parseFloat(rrRatio) >= 2
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : rrRatio !== '—' && parseFloat(rrRatio) >= 1
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-slate-500 dark:text-slate-400'
                                }`}>
                                  {rrRatio === '—' ? '—' : `1 : ${rrRatio}`}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Showing {filteredSnapshots.length} of {total} decisions
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500">Engine:</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${modeInfo.badgeColor}`}>
              {modeInfo.icon}
              {modeInfo.label}
            </span>
          </div>
        </div>

        {/* Error Toast */}
        {error && (
          <div className="fixed bottom-6 right-6 z-50 animate-fade-in rounded-xl border border-rose-200 bg-white px-4 py-3 shadow-lg dark:border-rose-500/30 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-rose-500" />
              <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
              <button onClick={() => setError('')} className="ml-2 text-xs text-slate-400 hover:text-slate-600">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
