'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ToggleLeft, ToggleRight, BarChart3, Save, Loader2 } from 'lucide-react';

export default function Settings() {
  const [data, setData] = useState(null);
  const [flowConfig, setFlowConfig] = useState(null);
  const [status, setStatus] = useState('idle');
  const [flowSaveStatus, setFlowSaveStatus] = useState(null);
  const [flowEdits, setFlowEdits] = useState({});

  useEffect(() => {
    const loadData = async () => {
      setStatus('loading');
      try {
        const [settingsRes, flowRes] = await Promise.all([
          fetch('/api/settings/status', { credentials: 'include' }),
          fetch('/api/flow/config', { credentials: 'include' }),
        ]);
        if (settingsRes.ok) {
          const payload = await settingsRes.json();
          setData(payload);
        }
        if (flowRes.ok) {
          const flowPayload = await flowRes.json();
          setFlowConfig(flowPayload);
        }
        setStatus('success');
      } catch (error) {
        setStatus('error');
      }
    };
    loadData();
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="muted text-sm">System configuration and feature controls.</p>
      </div>

      {status === 'error' && (
        <div className="card p-6 text-sm text-rose-500">Unable to load system status.</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Trading Mode & Health</h2>
          <div className="mt-4 grid gap-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">System Status</p>
                <p className="muted text-xs">Overall health check</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                {data?.health || 'Loading'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Database</p>
                <p className="muted text-xs">Connection status</p>
              </div>
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                {data?.database || 'Checking'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Uptime</p>
                <p className="muted text-xs">System runtime</p>
              </div>
              <span className="text-sm font-semibold">{data?.uptime || '--'}</span>
            </div>
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4 text-xs text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
              <ShieldCheck className="mb-2 h-4 w-4" />
              Authentication is handled securely via JWT tokens. No API keys are stored in the browser.
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold">Feature Flags</h2>
          <div className="mt-4 flex flex-col gap-3">
            {(data?.features || []).map((feature) => (
              <div
                key={feature.name}
                className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"
              >
                <div>
                  <p className="font-medium">{feature.name}</p>
                  <p className="muted text-xs">Toggle feature access</p>
                </div>
                {feature.enabled ? (
                  <ToggleRight className="h-6 w-6 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-slate-400" />
                )}
              </div>
            ))}
            {status === 'loading' && (
              <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
            )}
          </div>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-white/40 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/40">
            <p className="text-sm font-semibold">Trading Mode</p>
            <p className="muted">Current mode: {data?.mode || 'Paper'}</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 size={20} />
            Flow & Confluence
          </h2>
          <p className="muted mt-1 text-sm">Trade gate, position sizing, and confluence threshold. Editable from UI.</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Confluence Threshold</p>
                <p className="muted text-xs">Minimum score to pass trade gate</p>
              </div>
              <input
                type="number"
                min={30}
                max={95}
                value={flowEdits.confluenceMinThreshold ?? flowConfig?.confluenceMinThreshold ?? 75}
                onChange={(e) => setFlowEdits((prev) => ({ ...prev, confluenceMinThreshold: Number(e.target.value) }))}
                className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Trade Gate</p>
                <p className="muted text-xs">Reject signals below threshold</p>
              </div>
              <button
                type="button"
                onClick={() => setFlowEdits((prev) => ({ ...prev, enableConfluenceGate: !(flowEdits.enableConfluenceGate ?? flowConfig?.enableConfluenceGate ?? true) }))}
                className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Toggle trade gate"
              >
                {(flowEdits.enableConfluenceGate ?? flowConfig?.enableConfluenceGate ?? true) ? (
                  <ToggleRight className="h-6 w-6 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-slate-400" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Position Sizing</p>
                <p className="muted text-xs">Scale size by confluence tier</p>
              </div>
              <button
                type="button"
                onClick={() => setFlowEdits((prev) => ({ ...prev, enableConfluenceSizing: !(flowEdits.enableConfluenceSizing ?? flowConfig?.enableConfluenceSizing ?? true) }))}
                className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Toggle position sizing"
              >
                {(flowEdits.enableConfluenceSizing ?? flowConfig?.enableConfluenceSizing ?? true) ? (
                  <ToggleRight className="h-6 w-6 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-slate-400" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-sm font-medium">Base Position Size</p>
                <p className="muted text-xs">Units per trade (before multiplier)</p>
              </div>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={flowEdits.basePositionSize ?? flowConfig?.basePositionSize ?? 1}
                onChange={(e) => setFlowEdits((prev) => ({ ...prev, basePositionSize: Number(e.target.value) }))}
                className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                setFlowSaveStatus('saving');
                try {
                  const res = await fetch('/api/flow/config', {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      confluenceMinThreshold: flowEdits.confluenceMinThreshold ?? flowConfig?.confluenceMinThreshold,
                      enableConfluenceGate: flowEdits.enableConfluenceGate ?? flowConfig?.enableConfluenceGate,
                      enableConfluenceSizing: flowEdits.enableConfluenceSizing ?? flowConfig?.enableConfluenceSizing,
                      basePositionSize: flowEdits.basePositionSize ?? flowConfig?.basePositionSize,
                    }),
                  });
                  const updated = await res.json();
                  if (res.ok) {
                    setFlowConfig(updated);
                    setFlowEdits({});
                    setFlowSaveStatus('success');
                    setTimeout(() => setFlowSaveStatus(null), 2000);
                  } else setFlowSaveStatus('error');
                } catch {
                  setFlowSaveStatus('error');
                }
              }}
              disabled={flowSaveStatus === 'saving' || Object.keys(flowEdits).length === 0}
              className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {flowSaveStatus === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
            {flowSaveStatus === 'success' && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved!</span>}
            {flowSaveStatus === 'error' && <span className="text-sm text-rose-500">Failed to save.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
