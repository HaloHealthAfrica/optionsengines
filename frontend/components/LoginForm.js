'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, UserPlus } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const [csrfToken, setCsrfToken] = useState('');
  const [status, setStatus] = useState('idle');
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login');

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

    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setStatus('loading');
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || (mode === 'register' ? 'Registration failed' : 'Login failed'));
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
      <div className="flex gap-2 rounded-2xl bg-slate-100 p-1 text-xs font-semibold text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 rounded-2xl px-3 py-2 transition ${
            mode === 'login' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : ''
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('register')}
          className={`flex-1 rounded-2xl px-3 py-2 transition ${
            mode === 'register' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : ''
          }`}
        >
          Create account
        </button>
      </div>
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
      {mode === 'register' && (
        <div>
          <label className="text-xs font-medium text-slate-500">Confirm password</label>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <UserPlus size={16} className="text-slate-400" />
            <input
              type="password"
              required
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="••••••••"
              aria-label="Confirm password"
            />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <button
        type="submit"
        className="gradient-button mt-2 rounded-2xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
        disabled={status === 'loading'}
      >
        {status === 'loading'
          ? mode === 'register'
            ? 'Creating account...'
            : 'Signing in...'
          : mode === 'register'
          ? 'Create account'
          : 'Sign in'}
      </button>
      <p className="text-xs text-slate-400">
        {mode === 'register'
          ? 'Accounts are created in the backend database.'
          : 'Demo access uses the credentials in your environment variables.'}
      </p>
    </form>
  );
}
