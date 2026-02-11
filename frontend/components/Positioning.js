'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import DataSourceBanner from './DataSourceBanner';
import DataFreshnessIndicator from './DataFreshnessIndicator';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'META', 'NFLX', 'IWM'];
const tabs = ['Overview', 'GEX Analysis', 'Max Pain', 'Options Flow', 'Signal Correlation'];

function formatGammaRegime(regime) {
  const value = String(regime || '').toUpperCase();
  if (value === 'LONG_GAMMA') return 'Long Gamma';
  if (value === 'SHORT_GAMMA') return 'Short Gamma';
  if (value === 'NEUTRAL') return 'Neutral';
  return '--';
}

function gammaBadgeClass(regime) {
  const value = String(regime || '').toUpperCase();
  if (value === 'LONG_GAMMA') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (value === 'SHORT_GAMMA') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  if (value === 'NEUTRAL') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
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

function isNoTradeDay(gamma) {
  if (!gamma || String(gamma.regime || '').toUpperCase() !== 'SHORT_GAMMA') {
    return false;
  }
  if (!Number.isFinite(Number(gamma.distanceATR))) {
    return false;
  }
  return Math.abs(Number(gamma.distanceATR)) <= 0.5;
}

export default function Positioning() {
  const [symbol, setSymbol] = useState('SPY');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Overview');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [dataSource, setDataSource] = useState('unknown');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        setSymbol(query.toUpperCase());
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchData = useMemo(
    () => async () => {
      setStatus('loading');
      try {
        const response = await fetch(`/api/positioning/${symbol}`);
        if (!response.ok) throw new Error('Failed to load positioning');
        setDataSource(response.headers.get('x-data-source') || 'unknown');
        const payload = await response.json();
        setData(payload);
        setStatus('success');
        setLastUpdated(Date.now());
      } catch (error) {
        setStatus('error');
      }
    },
    [symbol]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useAutoRefresh(fetchData, 30000, true);

  const suggestions = useMemo(() => {
    if (!query) return defaultSymbols;
    return defaultSymbols.filter((item) => item.startsWith(query.toUpperCase()));
  }, [query]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Market Positioning</h1>
          <p className="muted text-sm">Real-time sentiment, flow, and GEX context.</p>
          <p className="muted text-xs">Data source: {dataSource}</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbol"
            className="w-full rounded-2xl border border-slate-200 bg-white/80 py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900/80"
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

      <DataSourceBanner source={dataSource} />
      <DataFreshnessIndicator lastUpdated={lastUpdated} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Positioning views">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`tab-button ${tab === activeTab ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
            aria-pressed={tab === activeTab}
            role="tab"
          >
            {tab}
          </button>
        ))}
      </div>

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">
          Unable to load positioning data for {symbol}. Try another ticker.
        </div>
      )}

      {status === 'loading' && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={`loading-${idx}`} className="card h-40 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          ))}
        </div>
      )}

      {status === 'success' && data && (
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="flex flex-col gap-6">
            {(activeTab === 'Overview' || activeTab === 'GEX Analysis') && (
              <div className="card p-6">
                <h2 className="text-lg font-semibold">{symbol} GEX Summary</h2>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/60">
                    <p className="muted text-xs">Total GEX</p>
                    <p className="text-xl font-semibold">{data.gex.total}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
                    <p className="text-xs text-emerald-600">Call GEX</p>
                    <p className="text-lg font-semibold text-emerald-600">{data.gex.call}</p>
                  </div>
                  <div className="rounded-2xl bg-rose-50 p-4 dark:bg-rose-500/10">
                    <p className="text-xs text-rose-500">Put GEX</p>
                    <p className="text-lg font-semibold text-rose-500">{data.gex.put}</p>
                  </div>
                </div>
              </div>
            )}

            {(activeTab === 'Overview' || activeTab === 'Options Flow') && (
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Options Flow Summary</h2>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/60">
                    <p className="muted text-xs">Net Premium</p>
                    <p className="text-xl font-semibold">{data.optionsFlow.premium}</p>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
                    <p className="text-xs text-emerald-600">Bullish Sentiment</p>
                    <p className="text-lg font-semibold text-emerald-600">{data.optionsFlow.bullish}%</p>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-rose-50 p-4 dark:bg-rose-500/10">
                    <p className="text-xs text-rose-500">Bearish Sentiment</p>
                    <p className="text-lg font-semibold text-rose-500">{data.optionsFlow.bearish}%</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            {(activeTab === 'Overview' || activeTab === 'Max Pain') && (
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Max Pain Analysis</h2>
                <div className="mt-6 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Max Pain Strike</p>
                  <p className="text-4xl font-semibold">{data.maxPain.strike}</p>
                  <p className="muted mt-2 text-xs">{data.maxPain.note}</p>
                </div>
              </div>
            )}

            {(activeTab === 'Overview' || activeTab === 'GEX Analysis') && (
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
                  {isNoTradeDay(data.gamma) && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                      Market structure not supportive today
                    </div>
                  )}
                </div>
              </div>
            )}

            {(activeTab === 'Overview' || activeTab === 'Signal Correlation') && (
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Signal Correlation</h2>
                <div className="mt-4 flex flex-col gap-3">
                  {data.correlation.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                      <span>{item.label}</span>
                      <div className="flex flex-1 items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-2 rounded-full ${item.color}`}
                            style={{ width: `${item.value * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold">{item.value.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
