'use client';

import Image from 'next/image';
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Moon,
  RadioTower,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';

const iconMap = {
  dashboard: LayoutDashboard,
  positioning: BarChart3,
  orders: Activity,
  history: Activity,
  monitoring: RadioTower,
  'decision-engines': BarChart3,
  testing: Activity,
  settings: SettingsIcon,
};

export default function Sidebar({ tabs, activeTab, onTabChange, theme, onToggleTheme }) {
  return (
    <aside className="glass flex w-72 flex-col gap-6 rounded-3xl p-6 shadow-card">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-brand-500 via-cyan-500 to-brand-600 p-2">
          <Image src="/brand-mark.svg" alt="OptionAgents logo" width={28} height={28} priority />
        </div>
        <div>
          <p className="text-lg font-semibold">OptionAgents</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Automated Trading Platform</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2" aria-label="Primary navigation">
        {tabs.map((tab) => {
          const Icon = iconMap[tab.id] || LayoutDashboard;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-card dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-800/60'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
        <span>Theme</span>
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1 text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-900"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        aria-label="Logout"
        onClick={async () => {
          const csrf = await fetch('/api/auth/csrf').then((res) => res.json());
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'x-csrf-token': csrf.token },
          });
          window.location.href = '/login';
        }}
      >
        <LogOut size={16} />
        Logout
      </button>
    </aside>
  );
}
