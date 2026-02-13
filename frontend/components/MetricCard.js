'use client';

import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';

export default function MetricCard({ label, value, delta, trend, onClick, cardId }) {
  const isPositive = trend === 'up';
  const isNeutral = trend === 'neutral';
  const isClickable = Boolean(onClick);
  const Wrapper = isClickable ? 'button' : 'div';
  const badgeClass = isNeutral
    ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
    : isPositive
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return (
    <Wrapper
      type={isClickable ? 'button' : undefined}
      onClick={isClickable ? () => onClick(cardId ?? label) : undefined}
      className={`card flex w-full flex-col gap-3 p-5 text-left transition hover:-translate-y-1 hover:shadow-glass ${isClickable ? 'cursor-pointer' : ''}`}
      aria-label={isClickable ? `View details for ${label}` : undefined}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <div className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${badgeClass}`}>
          {!isNeutral && (isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />)}
          {delta}
        </div>
      </div>
      <p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
      {isClickable && (
        <span className="muted flex items-center gap-1 text-xs">
          View details <ChevronRight size={12} />
        </span>
      )}
    </Wrapper>
  );
}
