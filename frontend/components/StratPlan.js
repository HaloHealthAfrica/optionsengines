'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, Plus, Trash2, GripVertical, Target, AlertCircle } from 'lucide-react';

export default function StratPlan() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [addSymbol, setAddSymbol] = useState('');
  const [createPlan, setCreatePlan] = useState({ symbol: '', direction: 'long', timeframe: '1d' });

  const loadData = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/strat-plan/dashboard');
      if (res.status === 503) {
        setError('Strat Plan Lifecycle Engine is disabled. Set ENABLE_STRAT_PLAN_LIFECYCLE=true to enable.');
        setData(null);
        setStatus('idle');
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setData(payload);
      setStatus('success');
    } catch (err) {
      setError(err?.message || 'Failed to load Strat Plan data');
      setData(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddTicker = async (e) => {
    e.preventDefault();
    const symbol = addSymbol?.trim()?.toUpperCase();
    if (!symbol) return;
    try {
      const res = await fetch('/api/strat-plan/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, priority_score: 0 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.reason || 'Add failed');
      setAddSymbol('');
      loadData();
    } catch (err) {
      setError(err?.message);
    }
  };

  const handleRemoveTicker = async (symbol) => {
    try {
      const res = await fetch(`/api/strat-plan/watchlist/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.reason || 'Remove failed');
      loadData();
    } catch (err) {
      setError(err?.message);
    }
  };

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    const { symbol, direction, timeframe } = createPlan;
    const sym = symbol?.trim()?.toUpperCase();
    if (!sym) return;
    try {
      const res = await fetch('/api/strat-plan/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, direction, timeframe }),
      });
      const json = await res.json();
      if (!res.ok && !json?.plan) throw new Error(json?.error || json?.reason || 'Create failed');
      setCreatePlan({ symbol: '', direction: 'long', timeframe: '1d' });
      loadData();
    } catch (err) {
      setError(err?.message);
    }
  };

  if (error && !data) {
    return (
      <section className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Strat Plan Lifecycle</h1>
        <div className="card flex items-center gap-3 rounded-2xl border-amber-200 bg-amber-50 p-6 dark:border-amber-800/50 dark:bg-amber-950/30">
          <AlertCircle className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">{error}</p>
            <p className="muted mt-1 text-sm">
              Enable the feature with <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">ENABLE_STRAT_PLAN_LIFECYCLE=true</code> and run migrations.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const watchlist = data?.watchlist ?? {};
  const plans = data?.plans ?? {};
  const entries = watchlist.entries ?? [];
  const maxTickers = watchlist.max_tickers ?? 10;
  const atCapacity = watchlist.at_capacity ?? false;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Strat Plan Lifecycle</h1>
          <p className="muted text-sm">Focused execution: max 10 tickers, controlled plan capacity.</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="gradient-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
          aria-label="Refresh"
        >
          <RefreshCcw size={16} className={status === 'loading' ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && data && (
        <div className="card flex items-center gap-3 rounded-2xl border-rose-200 bg-rose-50 p-4 dark:border-rose-800/50 dark:bg-rose-950/30">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Watchlist Control Panel */}
      <div className="card overflow-hidden rounded-2xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Target size={20} />
          Watchlist
          <span className="muted text-sm font-normal">
            ({entries.length}/{maxTickers})
          </span>
          {atCapacity && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              At capacity
            </span>
          )}
        </h2>

        <form onSubmit={handleAddTicker} className="mb-4 flex gap-2">
          <input
            type="text"
            value={addSymbol}
            onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
            placeholder="Add ticker (e.g. SPY)"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            maxLength={10}
            disabled={atCapacity}
          />
          <button
            type="submit"
            disabled={atCapacity || !addSymbol?.trim()}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus size={16} />
            Add
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {entries.length === 0 && status !== 'loading' && (
            <p className="muted text-sm">No tickers in watchlist. Add symbols to enable plans.</p>
          )}
          {entries.map((e) => (
            <div
              key={e.symbol}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
            >
              <GripVertical size={14} className="text-slate-400" />
              <span className="font-medium">{e.symbol}</span>
              <span className="muted text-xs">{e.source}</span>
              <button
                type="button"
                onClick={() => handleRemoveTicker(e.symbol)}
                className="ml-1 rounded p-1 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30"
                aria-label={`Remove ${e.symbol}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Create Plan */}
      <div className="card overflow-hidden rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-semibold">Create Plan</h2>
        <form onSubmit={handleCreatePlan} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Symbol</label>
            <input
              type="text"
              value={createPlan.symbol}
              onChange={(e) => setCreatePlan((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))}
              placeholder="SPY"
              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Direction</label>
            <select
              value={createPlan.direction}
              onChange={(e) => setCreatePlan((p) => ({ ...p, direction: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Timeframe</label>
            <input
              type="text"
              value={createPlan.timeframe}
              onChange={(e) => setCreatePlan((p) => ({ ...p, timeframe: e.target.value }))}
              placeholder="1d"
              className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Create Plan
          </button>
        </form>
      </div>

      {/* Plan Dashboard */}
      <div className="card overflow-hidden rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-semibold">Plan Status</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="muted text-xs">Total Plans</p>
            <p className="text-2xl font-semibold">{plans.total ?? 0}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="muted text-xs">In Force</p>
            <p className="text-2xl font-semibold">{plans.in_force_count ?? 0}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="muted text-xs">Capacity</p>
            <p className="text-2xl font-semibold">
              {plans.at_capacity ? (
                <span className="text-amber-600">Full</span>
              ) : (
                <span className="text-emerald-600">Available</span>
              )}
            </p>
          </div>
        </div>
        {Object.keys(plans.plans_by_ticker ?? {}).length > 0 && (
          <div className="mt-4">
            <p className="muted mb-2 text-sm">Plans by ticker</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(plans.plans_by_ticker).map(([sym, count]) => (
                <span
                  key={sym}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-sm dark:border-slate-700"
                >
                  {sym}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
        {Object.keys(plans.by_state ?? {}).length > 0 && (
          <div className="mt-4">
            <p className="muted mb-2 text-sm">By state</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(plans.by_state).map(([state, count]) => (
                <span
                  key={state}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-sm dark:border-slate-700"
                >
                  {state}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
