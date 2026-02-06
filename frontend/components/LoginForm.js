'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const [csrfToken, setCsrfToken] = useState('');
  const [status, setStatus] = useState('idle');
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const loadCsrf = async () => {
      const response = await fetch('/api/auth/csrf');
      const payload = await response.json();
      setCsrfToken(payload.token);
    };
    loadCsrf();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.email.includes('@') || form.password.length < 4) {
      setError('Enter a valid email and password.');
      return;
    }

    setStatus('loading');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Login failed');
      }

      router.push('/');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      setStatus('idle');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <div>
        <label className="text-xs font-medium text-slate-500">Email</label>
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <Mail size={16} className="text-slate-400" />
          <input
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="demo@optionagents.ai"
            aria-label="Email address"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">Password</label>
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <Lock size={16} className="text-slate-400" />
          <input
            type="password"
            required
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="••••••••"
            aria-label="Password"
          />
        </div>
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <button
        type="submit"
        className="gradient-button mt-2 rounded-2xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Signing in...' : 'Sign in'}
      </button>
      <p className="text-xs text-slate-400">
        Demo access uses the credentials in your environment variables.
      </p>
    </form>
  );
}
