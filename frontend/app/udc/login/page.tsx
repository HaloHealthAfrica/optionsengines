import Image from 'next/image';
import LoginForm from '@/components/LoginForm';

export const metadata = {
  title: 'UDC | Login',
};

export default function UDCLoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-12 text-white">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-10 lg:flex-row">
        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-brand-500 via-cyan-500 to-brand-600 p-2">
              <Image src="/brand-mark.svg" alt="OptionAgents logo" width={32} height={32} />
            </div>
            <div>
              <p className="text-lg font-semibold">OptionAgents</p>
              <p className="text-xs text-slate-300">Unified Decision Core</p>
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-semibold leading-tight">
            Parallel decision engine with full audit trail and zero execution risk.
          </h1>
          <p className="mt-4 text-sm text-slate-300">
            Sign in to access the UDC dashboard. Monitor shadow decisions, review order plans,
            and track strategy performance in real time.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {['Shadow Mode', 'Deterministic', 'Fail-Closed', 'Audit Trail'].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="glass w-full max-w-md rounded-3xl p-8 text-slate-900 dark:text-slate-100">
          <h2 className="text-xl font-semibold">Sign in to UDC</h2>
          <p className="muted mb-6 text-sm">Use your secure credentials to continue.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
