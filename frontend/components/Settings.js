'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

export default function Settings() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const loadData = async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/settings/status');
        if (!response.ok) throw new Error('Failed');
        const payload = await response.json();
        setData(payload);
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

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
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
      </div>
    </section>
  );
}
