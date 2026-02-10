'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCcw } from 'lucide-react';
import { useRealtime } from '../hooks/useRealtime';
import DataSourceBanner from './DataSourceBanner';
import DataFreshnessIndicator from './DataFreshnessIndicator';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'META', 'NFLX', 'IWM'];

function gammaBadgeClass(regime) {
  const value = String(regime || '').toUpperCase();
  if (value === 'LONG_GAMMA') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (value === 'SHORT_GAMMA') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  if (value === 'NEUTRAL') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function formatGammaRegime(regime) {
  const value = String(regime || '').toUpperCase();
  if (value === 'LONG_GAMMA') return 'Long Gamma';
  if (value === 'SHORT_GAMMA') return 'Short Gamma';
  if (value === 'NEUTRAL') return 'Neutral';
  return '--';
}

function formatExpectedBehavior(value, regime) {
  const fallback =
    String(regime || '').toUpperCase() === 'LONG_GAMMA' ? 'MEAN_REVERT' : 'EXPANSION';
  const behavior = String(value || fallback).toUpperCase();
  if (behavior === 'MEAN_REVERT') return 'Mean Reversion';
  if (behavior === 'EXPANSION') return 'Expansion';
  return '--';
}

function formatZeroGamma(level) {
  if (!Number.isFinite(Number(level))) return '--';
  return Number(level).toFixed(2);
}

function formatDistanceATR(value) {
  if (!Number.isFinite(Number(value))) return '--';
  const rounded = Math.round(Number(value) * 100) / 100;
  return `${rounded} ATR`;
}

export default function IntelConsole() {
  const [symbol, setSymbol] = useState('SPY');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [dataSource, setDataSource] = useState('unknown');
  const [lastUpdated, setLastUpdated] = useState(null);
  const { intel } = useRealtime({ symbol });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        setSymbol(query.toUpperCase());
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchSnapshot = async (ticker) => {
    setStatus('loading');
    try {
      const response = await fetch(`/api/intel/latest?symbol=${encodeURIComponent(ticker)}`);
      if (!response.ok) throw new Error('Failed to load intel snapshot');
      setDataSource(response.headers.get('x-data-source') || 'unknown');
      const payload = await response.json();
      setData(payload);
      setStatus('success');
      setLastUpdated(Date.now());
    } catch (error) {
      setStatus('error');
    }
  };

  useEffect(() => {
    fetchSnapshot(symbol);
  }, [symbol]);

  useAutoRefresh(() => fetchSnapshot(symbol), 30000, true);

  useEffect(() => {
    if (intel && intel.symbol === symbol) {
      setData(intel);
      setStatus('success');
      setLastUpdated(Date.now());
    }
  }, [intel, symbol]);

  const suggestions = useMemo(() => {
    if (!query) return defaultSymbols;
    return defaultSymbols.filter((item) => item.startsWith(query.toUpperCase()));
  }, [query]);

  const isNoTradeDay = Boolean(data?.gamma?.noTradeDay);
  const allowTrading = data?.allowTrading ?? true;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Market Intel Console</h1>
          <p className="muted text-sm">High-conviction context from GEX and gamma regime.</p>
          <p className="muted text-xs">Data source: {dataSource}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fetchSnapshot(symbol)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <RefreshCcw size={14} />
            Refresh
          </button>
          <div className="relative w-full max-w-xs">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search symbol"
              className="w-full rounded-2xl border border-slate-200 bg-white/80 py-2 pl-3 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900/80"
              aria-label="Search symbol"
            />
            {query && (
              <div className="absolute left-0 right-0 top-12 z-10 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.length === 0 && (
                  <p className="muted px-3 py-2 text-xs">No matching symbols</p>
                )}
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setSymbol(item);
                      setQuery('');
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {item}
                    <span className="muted text-xs">View</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <DataSourceBanner source={dataSource} />
      <DataFreshnessIndicator lastUpdated={lastUpdated} />

      {status === 'error' && (
        <div className="card border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
          Unable to load intel snapshot for {symbol}. Try again.
        </div>
      )}

      {status === 'loading' && (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={`loading-${idx}`} className="card h-32 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          ))}
        </div>
      )}

      {status === 'success' && data && (
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="flex flex-col gap-6">
            <div
              className={`card border p-5 ${
                allowTrading
                  ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                  : 'border-amber-200 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/10'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {allowTrading ? 'Trade Day: YES' : 'Trade Day: NO'}
                  </p>
                  <p className="muted text-xs">{symbol} structural context snapshot</p>
                </div>
                {allowTrading ? (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                ) : (
                  <AlertTriangle size={18} className="text-amber-500" />
                )}
              </div>
              {data.message && (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-200">{data.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="card p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Gamma Regime</h2>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${gammaBadgeClass(
                    data.gamma?.regime
                  )}`}
                >
                  {formatGammaRegime(data.gamma?.regime)}
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between">
                    <span className="muted text-xs">Zero Gamma Level</span>
                    <span className="font-semibold">{formatZeroGamma(data.gamma?.zeroGammaLevel)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted text-xs">Distance to Zero</span>
                    <span className="font-semibold">{formatDistanceATR(data.gamma?.distanceATR)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted text-xs">Expected Behavior</span>
                    <span className="font-semibold">
                      {formatExpectedBehavior(data.gamma?.expectedBehavior, data.gamma?.regime)}
                    </span>
                  </div>
                </div>
                {isNoTradeDay && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                    Market structure not supportive today
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
