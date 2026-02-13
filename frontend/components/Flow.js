'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Bell, CheckCircle, XCircle } from 'lucide-react';
import DataSourceBanner from './DataSourceBanner';
import DataFreshnessIndicator from './DataFreshnessIndicator';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'META', 'NFLX', 'IWM'];
const tabs = ['Overview', 'Details', 'Signals', 'Alerts'];

function RecentSignalsCard({ symbol }) {
  const [signals, setSignals] = useState([]);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/flow/${symbol}/signals?limit=20`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setSignals(data.signals ?? []);
          setStatus('success');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [symbol]);

  if (status === 'loading') {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold">Recent Signals</h2>
        <div className="mt-4 h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/40" />
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold">Recent Signals</h2>
        <p className="muted mt-4 text-sm">No signals for {symbol} in the last 7 days.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold">Recent Signals</h2>
      <p className="muted mt-1 text-sm">Last 7 days for {symbol}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 text-left font-medium">Time</th>
              <th className="py-2 text-left font-medium">Direction</th>
              <th className="py-2 text-left font-medium">Status</th>
              <th className="py-2 text-left font-medium">Confluence</th>
              <th className="py-2 text-left font-medium">Gate</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.signal_id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 text-slate-600 dark:text-slate-400">
                  {s.created_at ? new Date(s.created_at).toLocaleString() : '--'}
                </td>
                <td className="py-2 font-medium capitalize">{s.direction ?? '--'}</td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      s.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                        : s.status === 'rejected'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="py-2">{s.confluence?.score ?? '--'}</td>
                <td className="py-2">
                  {s.confluence ? (
                    s.confluence.tradeGatePasses ? (
                      <span className="text-emerald-600 dark:text-emerald-400">Pass</span>
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400">Block</span>
                    )
                  ) : (
                    '--'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsStatusCard({ symbol }) {
  const [alerts, setAlerts] = useState(null);
  const [status, setStatus] = useState('idle');
  const [testStatus, setTestStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('idle');

  const refresh = () => {
    setStatus('loading');
    fetch('/api/flow/alerts/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setAlerts(data);
        setStatus('success');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setHistoryStatus('loading');
    const url = symbol ? `/api/flow/alerts/history?limit=20&symbol=${symbol}` : '/api/flow/alerts/history?limit=20';
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setHistory(data.alerts ?? []);
        setHistoryStatus('success');
      })
      .catch(() => setHistoryStatus('error'));
  }, [symbol]);

  const handleTestAlert = () => {
    setTestStatus('sending');
    fetch('/api/flow/alerts/test', {
      method: 'POST',
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((data) => {
        setTestStatus(data.success ? 'success' : 'error');
        if (data.success) {
          setTimeout(() => setTestStatus(null), 3000);
        }
      })
      .catch(() => setTestStatus('error'));
  };

  if (status === 'loading') {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold">Alerts Status</h2>
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/40" />
      </div>
    );
  }

  const a = alerts ?? {};
  const hasWebhook = a.discordConfigured || a.slackConfigured;

  return (
    <div className="card p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Bell size={20} />
        Alerts Status
      </h2>
      <p className="muted mt-1 text-sm">Confluence alerts when score &ge; {a.confluenceThreshold ?? 75}</p>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
          <span className="text-sm">Alerts enabled</span>
          {a.alertsEnabled ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle size={16} /> On
            </span>
          ) : (
            <span className="flex items-center gap-1 text-slate-500">
              <XCircle size={16} /> Off
            </span>
          )}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
          <span className="text-sm">Discord</span>
          {a.discordConfigured ? (
            <span className="text-emerald-600 dark:text-emerald-400">Configured</span>
          ) : (
            <span className="muted text-sm">Not configured</span>
          )}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
          <span className="text-sm">Slack</span>
          {a.slackConfigured ? (
            <span className="text-emerald-600 dark:text-emerald-400">Configured</span>
          ) : (
            <span className="muted text-sm">Not configured</span>
          )}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
          <span className="text-sm">Cooldown</span>
          <span className="font-medium">{a.cooldownMinutes ?? 30} min</span>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleTestAlert}
            disabled={!hasWebhook || testStatus === 'sending'}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testStatus === 'sending' ? 'Sending…' : testStatus === 'success' ? 'Sent!' : 'Send Test Alert'}
          </button>
          {testStatus === 'success' && (
            <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Check Discord/Slack for the test message.</p>
          )}
          {testStatus === 'error' && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">Failed to send. Check webhook URLs.</p>
          )}
          {!hasWebhook && (
            <p className="muted mt-2 text-xs">Configure DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL to test.</p>
          )}
        </div>
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Alert History</h3>
          {historyStatus === 'loading' && (
            <div className="mt-2 h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/40" />
          )}
          {historyStatus === 'success' && history.length === 0 && (
            <p className="muted mt-2 text-sm">No alerts sent yet.</p>
          )}
          {historyStatus === 'success' && history.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 text-left font-medium">Time</th>
                    <th className="py-2 text-left font-medium">Symbol</th>
                    <th className="py-2 text-left font-medium">Dir</th>
                    <th className="py-2 text-left font-medium">Score</th>
                    <th className="py-2 text-left font-medium">Netflow</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.flow_alert_id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 text-slate-600 dark:text-slate-400">
                        {h.created_at ? new Date(h.created_at).toLocaleString() : '--'}
                      </td>
                      <td className="py-2 font-medium">{h.symbol ?? '--'}</td>
                      <td className="py-2 capitalize">{h.direction ?? '--'}</td>
                      <td className="py-2">{h.confluence_score ?? '--'}</td>
                      <td className="py-2">{h.netflow_formatted ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

export default function Flow() {
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
        const response = await fetch(`/api/flow/${symbol}`);
        if (!response.ok) throw new Error('Failed to load flow data');
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

  const isNetflowBullish =
    (data?.netflow?.direction ?? data?.optionsFlow?.netflow ?? '') !== 'bearish' &&
    !String(data?.optionsFlow?.netflow ?? '').startsWith('-');

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Flow</h1>
          <p className="muted text-sm">Netflow, confluence, and trade decision context.</p>
          <p className="muted text-xs">
            Data source: {data?.flowSource ?? dataSource}
            {data?.netflowZScore != null && (
              <span className="ml-2">
                | Z-score: {data.netflowZScore.value}
                {data.netflowZScore.isUnusual && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">Unusual</span>
                )}
              </span>
            )}
          </p>
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Flow views">
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
          Unable to load flow data for {symbol}. Try another ticker.
        </div>
      )}

      {status === 'loading' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={`loading-${idx}`} className="card h-32 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          ))}
        </div>
      )}

      {status === 'success' && data && (
        <>
          {/* Primary: Flow-focused cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* Netflow */}
            <div
              className={`card p-5 ${
                isNetflowBullish ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-rose-500'
              }`}
            >
              <p className="muted text-xs font-medium uppercase tracking-wide">Netflow</p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  isNetflowBullish ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {data.netflow?.formatted ?? data.optionsFlow?.netflow ?? '--'}
              </p>
              <p className="muted mt-1 text-xs">
                {isNetflowBullish ? 'Call premium &gt; put' : 'Put premium &gt; call'}
              </p>
            </div>

            {/* Confluence Score */}
            <div
              className={`card p-5 ${
                (data.confluence?.score ?? 0) >= (data.confluence?.threshold ?? 75)
                  ? 'border-l-4 border-l-emerald-500'
                  : 'border-l-4 border-l-amber-500'
              }`}
            >
              <p className="muted text-xs font-medium uppercase tracking-wide">Confluence Score</p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  (data.confluence?.score ?? 0) >= (data.confluence?.threshold ?? 75)
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {data.confluence?.score ?? '--'}
              </p>
              <p className="muted mt-1 text-xs">Threshold: {data.confluence?.threshold ?? 75}</p>
            </div>

            {/* Signal Alignment */}
            <div className="card p-5">
              <p className="muted text-xs font-medium uppercase tracking-wide">Signal Alignment</p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  data.confluence?.alignment === 'aligned'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : data.confluence?.alignment === 'misaligned'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500'
                }`}
              >
                {data.confluence?.alignment === 'aligned'
                  ? 'Aligned'
                  : data.confluence?.alignment === 'misaligned'
                    ? 'Misaligned'
                    : 'Neutral'}
              </p>
              <p className="muted mt-1 text-xs">
                {data.confluence?.alignment === 'aligned'
                  ? 'Flow agrees with gamma'
                  : data.confluence?.alignment === 'misaligned'
                    ? 'Flow disagrees with gamma'
                    : 'No signal context'}
              </p>
            </div>

            {/* Trade Gate */}
            <div
              className={`card p-5 ${
                data.tradeGate?.passes ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-rose-500'
              }`}
            >
              <p className="muted text-xs font-medium uppercase tracking-wide">Trade Gate</p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  data.tradeGate?.passes ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {data.tradeGate?.passes ? 'Pass' : 'Block'}
              </p>
              <p className="muted mt-1 text-xs">{data.tradeGate?.reason ?? '--'}</p>
            </div>

            {/* Position Sizing */}
            <div className="card p-5">
              <p className="muted text-xs font-medium uppercase tracking-wide">Position Sizing</p>
              <p className="mt-1 text-2xl font-semibold capitalize">
                {data.positionSize?.tier ?? '--'}
              </p>
              <p className="muted mt-1 text-xs">
                {data.positionSize?.multiplier != null
                  ? `${Math.round((data.positionSize.multiplier ?? 0) * 100)}% size`
                  : '--'}
              </p>
            </div>
          </div>

          {/* Secondary: Gamma Regime + optional Details */}
          <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
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
              <p className="muted mt-2 text-sm">Context for confluence. Short gamma = expansion bias; long gamma = mean reversion.</p>
            </div>

            {(activeTab === 'Details' || activeTab === 'Overview') && (
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Flow Summary</h2>
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/60">
                    <span className="muted text-xs">Net Premium</span>
                    <span className="font-semibold">{data.optionsFlow?.premium ?? '--'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                    <span className="text-xs text-emerald-600">Bullish</span>
                    <span className="font-semibold text-emerald-600">{data.optionsFlow?.bullish ?? '--'}%</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-rose-50 p-3 dark:bg-rose-500/10">
                    <span className="text-xs text-rose-500">Bearish</span>
                    <span className="font-semibold text-rose-500">{data.optionsFlow?.bearish ?? '--'}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {activeTab === 'Details' && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Confluence Factors</h2>
                <p className="muted mt-1 text-sm">Breakdown of how the confluence score is computed.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {data.confluence?.factors && (
                    <>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                        <span className="text-sm">Flow–Gamma Alignment</span>
                        <span className="font-semibold">{data.confluence.factors.flowGammaAlignment}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                        <span className="text-sm">Signal–Flow Alignment</span>
                        <span className="font-semibold">{data.confluence.factors.signalFlowAlignment}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                        <span className="text-sm">Signal–Gamma Alignment</span>
                        <span className="font-semibold">{data.confluence.factors.signalGammaAlignment}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                        <span className="text-sm">Flow Strength</span>
                        <span className="font-semibold">{data.confluence.factors.flowStrength}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="card p-6">
                <h2 className="text-lg font-semibold">Additional Context</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="muted text-xs">GEX Total</p>
                    <p className="font-semibold">{data.gex?.total ?? '--'}</p>
                  </div>
                  <div>
                    <p className="muted text-xs">Max Pain</p>
                    <p className="font-semibold">{data.maxPain?.strike ?? '--'}</p>
                  </div>
                  <div>
                    <p className="muted text-xs">Zero Gamma Level</p>
                    <p className="font-semibold">{data.gamma?.zeroGammaLevel ?? '--'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Signals' && (
            <RecentSignalsCard symbol={symbol} />
          )}

          {activeTab === 'Alerts' && (
            <AlertsStatusCard symbol={symbol} />
          )}
        </>
      )}
    </section>
  );
}
