'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const scenarios = [
  {
    id: 'mixed_trades_30',
    label: '🚀 Run 30 Mixed Trades',
    payload: {
      scenario: 'mixed_trades_30',
      symbols: ['SPY', 'QQQ', 'SPX'],
      timeframes: ['1m', '5m', '15m', '1h', '1d'],
      signal_types: ['buy', 'sell'],
      count: 30,
      timing: 'realistic',
      realistic_prices: true,
    },
  },
  {
    id: 'high_volume_100',
    label: '📊 Simulate High Volume',
    payload: {
      scenario: 'high_volume_100',
      symbols: ['SPY', 'QQQ', 'SPX', 'AAPL', 'TSLA', 'MSFT'],
      timeframes: ['1m', '5m'],
      signal_types: ['buy', 'sell'],
      count: 100,
      timing: 'rapid',
      realistic_prices: true,
    },
  },
  {
    id: 'failure_scenarios',
    label: '⚠️ Test Failure Scenarios',
    payload: {
      scenario: 'failure_scenarios',
      symbols: ['SPY'],
      timeframes: ['30s'],
      signal_types: ['buy'],
      count: 10,
      timing: 'immediate',
      realistic_prices: true,
    },
  },
];

export default function TestingConsole() {
  const [tab, setTab] = useState('single');
  const [single, setSingle] = useState({
    symbol: 'SPY',
    timeframe: '5m',
    signal_type: 'buy',
    format: 'ultimate_options',
  });
  const [customJson, setCustomJson] = useState(
    JSON.stringify(
      {
        symbol: 'SPY',
        timeframe: '5m',
        direction: 'long',
        price: 452.33,
        indicators: { rsi: 67.5, macd: 1.23 },
        metadata: { is_test: true },
      },
      null,
      2
    )
  );
  const [validationMode, setValidationMode] = useState('strict');
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [customError, setCustomError] = useState(null);
  const [requestError, setRequestError] = useState(null);

  const fetchSession = useCallback(async (id) => {
    if (!id) return;
    const response = await fetch(`/api/testing/sessions/${id}`, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    setSessionData(payload);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetchSession(sessionId);
    const interval = setInterval(() => fetchSession(sessionId), 2000);
    return () => clearInterval(interval);
  }, [sessionId, fetchSession]);

  const summary = sessionData?.summary || {};

  const sendSingle = useCallback(async () => {
    setStatus('loading');
    setRequestError(null);
    try {
      const response = await fetch('/api/testing/webhooks/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(single),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRequestError(payload?.error || 'Failed to send test webhook');
        setStatus('error');
        return;
      }
      setSessionId(payload.test_session_id || null);
      setStatus('success');
    } catch (error) {
      setRequestError(error?.message || 'Failed to send test webhook');
      setStatus('error');
    }
  }, [single]);

  const sendScenario = useCallback(async (payload) => {
    setStatus('loading');
    setRequestError(null);
    try {
      const response = await fetch('/api/testing/webhooks/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRequestError(result?.error || 'Failed to send test batch');
        setStatus('error');
        return;
      }
      setSessionId(result.test_session_id || null);
      setStatus('success');
    } catch (error) {
      setRequestError(error?.message || 'Failed to send test batch');
      setStatus('error');
    }
  }, []);

  const sendCustom = useCallback(async () => {
    setStatus('loading');
    setCustomError(null);
    setRequestError(null);
    try {
      const parsed = JSON.parse(customJson);
      const response = await fetch('/api/testing/webhooks/send-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_payload: parsed, validation_mode: validationMode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRequestError(result?.error || 'Failed to send custom webhook');
        setStatus('error');
        return;
      }
      if (result.status === 'validation_failed') {
        setCustomError(result.validation_result?.errors?.join(', ') || 'Validation failed');
      } else {
        setSessionId(result.test_session_id || null);
      }
      setStatus('success');
    } catch (error) {
      setCustomError('Invalid JSON payload.');
      setRequestError('Invalid JSON payload.');
      setStatus('error');
    }
  }, [customJson, validationMode]);

  const loadRecentTemplate = useCallback(async () => {
    try {
      const response = await fetch('/api/webhooks/recent-production?limit=1&status=accepted');
      if (!response.ok) return;
      const payload = await response.json();
      const template = payload.webhooks?.[0]?.raw_payload;
      if (template) {
        setCustomJson(JSON.stringify(template, null, 2));
      }
    } catch {
      setCustomError('Failed to load recent production webhook.');
    }
  }, []);

  const clearSession = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`/api/testing/sessions/${sessionId}`, { method: 'DELETE' });
    setSessionData(null);
    setSessionId(null);
  }, [sessionId]);

  const summaryLabel = useMemo(() => {
    if (!sessionId) return 'No active tests';
    return `Session ${sessionId}`;
  }, [sessionId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Webhook Testing Console</h1>
        <p className="muted text-sm">Generate test webhooks through the full OptionAgents pipeline.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
        <div className="card p-6">
          <div className="flex items-center gap-2">
            {['single', 'batch', 'custom'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`tab-button ${tab === item ? 'tab-button-active' : 'bg-white/60 dark:bg-slate-900/50'}`}
              >
                {item === 'single' ? 'Single' : item === 'batch' ? 'Batch' : 'Custom'}
              </button>
            ))}
          </div>

          {tab === 'single' && (
            <div className="mt-6 grid gap-4 text-sm">
              <label className="grid gap-1">
                <span className="muted text-xs">Symbol</span>
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  value={single.symbol}
                  onChange={(event) => setSingle((prev) => ({ ...prev, symbol: event.target.value }))}
                >
                  {['SPY', 'QQQ', 'SPX', 'AAPL', 'TSLA', 'MSFT'].map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="muted text-xs">Timeframe</span>
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  value={single.timeframe}
                  onChange={(event) => setSingle((prev) => ({ ...prev, timeframe: event.target.value }))}
                >
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="muted text-xs">Signal Type</span>
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  value={single.signal_type}
                  onChange={(event) => setSingle((prev) => ({ ...prev, signal_type: event.target.value }))}
                >
                  {['buy', 'sell'].map((signal) => (
                    <option key={signal} value={signal}>
                      {signal}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="muted text-xs">Webhook Format</span>
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  value={single.format}
                  onChange={(event) => setSingle((prev) => ({ ...prev, format: event.target.value }))}
                >
                  <option value="ultimate_options">Ultimate Options Strategy</option>
                  <option value="trend_start">Trend + Start Indicator</option>
                  <option value="dots_indicator">Dots Indicator</option>
                  <option value="market_context">Market Context Indicator</option>
                </select>
              </label>
              <button
                type="button"
                onClick={sendSingle}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                {status === 'loading' ? 'Sending...' : 'Send Test Webhook'}
              </button>
              {requestError && <p className="text-xs text-rose-500">{requestError}</p>}
            </div>
          )}

          {tab === 'batch' && (
            <div className="mt-6 grid gap-3 text-sm">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => sendScenario(scenario.payload)}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/40"
                >
                  {scenario.label}
                </button>
              ))}
            </div>
          )}

          {tab === 'custom' && (
            <div className="mt-6 grid gap-4 text-sm">
              <label className="grid gap-1">
                <span className="muted text-xs">Validation Mode</span>
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  value={validationMode}
                  onChange={(event) => setValidationMode(event.target.value)}
                >
                  {['strict', 'lenient', 'none'].map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="muted text-xs">Custom JSON</span>
                <textarea
                  className="h-52 rounded-2xl border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-900"
                  value={customJson}
                  onChange={(event) => setCustomJson(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={loadRecentTemplate}
                className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/40"
              >
                Load recent production webhook
              </button>
              {customError && <p className="text-xs text-rose-500">{customError}</p>}
              {requestError && <p className="text-xs text-rose-500">{requestError}</p>}
              <button
                type="button"
                onClick={sendCustom}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                {status === 'loading' ? 'Sending...' : 'Send Custom Webhook'}
              </button>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold">Live Results</h2>
          <p className="muted text-xs">{summaryLabel}</p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Accepted</span>
              <span className="font-semibold">{summary.accepted ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Duplicates</span>
              <span className="font-semibold">{summary.duplicates ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Failures</span>
              <span className="font-semibold">{summary.failed ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Decisions</span>
              <span className="font-semibold">{summary.decisions_made ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Orders created</span>
              <span className="font-semibold">{summary.orders_created ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Orders filled</span>
              <span className="font-semibold">{summary.orders_filled ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Avg processing</span>
              <span className="font-semibold">{summary.avg_processing_time_ms ?? 0} ms</span>
            </div>
          </div>
          <div className="mt-6 grid gap-2">
            <button
              type="button"
              onClick={() => sessionId && fetchSession(sessionId)}
              className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/40"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={clearSession}
              className="rounded-full border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-800/60 dark:text-rose-200 dark:hover:bg-rose-900/20"
            >
              Clear Test Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
