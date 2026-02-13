'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

const FLOW_SYMBOLS = ['SPY', 'IWM', 'QQQ', 'SMI', 'SPX'];

function regimeBadgeClass(regime) {
  const v = String(regime || '').toUpperCase();
  if (v === 'LONG_GAMMA') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
  if (v === 'SHORT_GAMMA') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200';
}

function DealerBiasArrow({ bias }) {
  const v = String(bias || '').toLowerCase();
  if (v === 'long') return <ArrowUp className="h-4 w-4 text-emerald-500" />;
  if (v === 'short') return <ArrowDown className="h-4 w-4 text-rose-500" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

export default function GammaPanel({ defaultSymbol = 'SPY' }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/gamma/${symbol}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setData(d);
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
      <div className="card p-4">
        <h2 className="text-base font-semibold">Gamma Panel</h2>
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/40" />
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Gamma Panel</h2>
        <div className="flex flex-wrap gap-1">
          {FLOW_SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                symbol === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {status === 'error' && (
        <p className="muted mt-3 text-sm">Gamma data unavailable. Check Unusual Whales API.</p>
      )}
      {status === 'success' && data && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
            <p className="muted text-xs">Net Gamma</p>
            <p className="mt-0.5 font-semibold">{data.formatted?.netGamma ?? '--'}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{
                  width: data.netGamma != null
                    ? `${Math.min(100, Math.abs(data.netGamma) / 1e8)}%`
                    : '0%',
                }}
              />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
            <p className="muted text-xs">Gamma Flip Level</p>
            <p className="mt-0.5 font-semibold">{data.formatted?.gammaFlip ?? '--'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
            <p className="muted text-xs">Dealer Bias</p>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold capitalize">
              <DealerBiasArrow bias={data.dealerBias} />
              {data.dealerBias ?? '--'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
            <p className="muted text-xs">Regime</p>
            <span
              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${regimeBadgeClass(
                data.regime
              )}`}
            >
              {data.regime ?? 'NEUTRAL'}
            </span>
          </div>
        </div>
      )}
      {status === 'success' && data?.topGammaWalls?.length > 0 && (
        <div className="mt-3">
          <p className="muted text-xs">Top 3 Gamma Walls</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.topGammaWalls.map((w, i) => (
              <span
                key={i}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800"
              >
                ${w.strike?.toFixed(2) ?? '--'} ({w.formatted ?? '--'})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
