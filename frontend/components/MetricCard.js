'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

export default function MetricCard({ label, value, delta, trend }) {
  const isPositive = trend === 'up';
  return (
    <div className="card flex flex-col gap-3 p-5 transition hover:-translate-y-1 hover:shadow-glass">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <div
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
            isPositive
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
          }`}
        >
          {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {delta}
        </div>
      </div>
      <p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
