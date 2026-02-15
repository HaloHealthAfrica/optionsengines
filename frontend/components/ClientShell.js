'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import Flow from './Flow';
import Orders from './Orders';
import History from './History';
import Settings from './Settings';
import Monitoring from './Monitoring';
import DecisionEnginePage from './DecisionEnginePage';
import TestingConsole from './TestingConsole';
import IntelConsole from './IntelConsole';
import AdaptiveControlPanel from './AdaptiveControlPanel';

const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'flow', label: 'Flow' },
  { id: 'orders', label: 'Orders' },
  { id: 'history', label: 'History' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'intel-console', label: 'Intel Console' },
  { id: 'decision-engines', label: 'Decision Engines' },
  { id: 'feedback-tuner', label: 'Feedback Tuner' },
  { id: 'testing', label: 'Testing' },
  { id: 'settings', label: 'Settings' },
];

export default function ClientShell() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const saved = window.localStorage.getItem('oa-theme');
    if (saved) {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('oa-theme', theme);
  }, [theme]);

  const ActiveView = useMemo(() => {
    switch (activeTab) {
      case 'flow':
        return <Flow />;
      case 'orders':
        return <Orders />;
      case 'history':
        return <History />;
      case 'monitoring':
        return <Monitoring />;
      case 'intel-console':
        return <IntelConsole />;
      case 'decision-engines':
        return <DecisionEnginePage />;
      case 'feedback-tuner':
        return <AdaptiveControlPanel />;
      case 'testing':
        return <TestingConsole />;
      case 'settings':
        return <Settings />;
        default:
        return <Dashboard onNavigateToTab={setActiveTab} />;
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1400px] gap-6 px-4 py-6 lg:px-8">
        <Sidebar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <main className="flex-1 transition-all duration-300">
          <div className="glass rounded-3xl p-6 shadow-card">
            <div key={activeTab} className="animate-fade-in">
              {ActiveView}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
