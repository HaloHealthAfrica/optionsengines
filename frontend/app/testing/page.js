import TestingConsole from '@/components/TestingConsole';

export default function TestingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="glass rounded-3xl p-6 shadow-card">
          <TestingConsole />
        </div>
      </div>
    </div>
  );
}
