import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiBase, getToken, setToken } from '../services/apiClient';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    return state?.from?.pathname ?? '/dashboard';
  }, [location.state]);

  useEffect(() => {
    if (getToken()) {
      navigate(from, { replace: true });
    }
  }, [from, navigate]);

  const API_BASE = getApiBase();

  const authRequest = async <T,>(endpoint: string, payload?: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await response.json().catch(() => ({})) : {};

    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? `Request failed: ${response.status}`);
    }

    return data as T;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'register' && password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const data = await authRequest<{ token?: string }>(endpoint, { email, password });
      if (!data.token) {
        throw new Error('No token returned from server');
      }

      setToken(data.token);
      navigate(from, { replace: true });
    } catch (err) {
      console.error('Auth error:', err);
      const errorMessage = (err as Error).message;
      setError(errorMessage.includes('Failed to fetch') 
        ? 'Cannot connect to server. Please check if the backend is running.' 
        : errorMessage
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await authRequest<{ token?: string }>('/auth/generate-token', {
        userId: 'demo-user',
        email: 'demo@example.com',
        role: 'admin',
      });
      if (!data.token) {
        throw new Error('No demo token returned');
      }

      setToken(data.token);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setConfirmPassword('');
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (error) {
      setError(null);
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (error) {
      setError(null);
    }
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (error) {
      setError(null);
    }
  };

  const isSubmitDisabled =
    loading || !email || !password || (mode === 'register' && !confirmPassword);

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-pill">OptionAgents</span>
          <h1>Automated options execution with dual-engine intelligence.</h1>
          <p>
            Monitor production-grade signals and shadow-engine experiments in one unified
            workspace.
          </p>
          <div className="auth-hero-grid">
            <div>
              <h3>Execution clarity</h3>
              <p>Trace every decision from signal to order impact.</p>
            </div>
            <div>
              <h3>Experiment safely</h3>
              <p>Validate multi-agent strategies before rollout.</p>
            </div>
            <div>
              <h3>Secure access</h3>
              <p>JWT-based auth with role-aware gates.</p>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-header">
            <p className="auth-eyebrow">{mode === 'login' ? 'Welcome back' : 'Create account'}</p>
            <h2>{mode === 'login' ? 'Sign in to OptionAgents' : 'Start a new workspace'}</h2>
            <p className="auth-subtitle">
              {mode === 'login'
                ? 'Use your team credentials to continue.'
                : 'Register a new account to access the platform.'}
            </p>
          </div>

          {error && <div className="auth-alert">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder={mode === 'login' ? 'admin@optionagents.com' : 'you@company.com'}
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <div className="auth-input-row">
                <input
                  id="password"
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={loading}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="auth-ghost"
                  onClick={() => setIsPasswordVisible((prev) => !prev)}
                  disabled={loading}
                >
                  {isPasswordVisible ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="auth-field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
            )}

            <button className="auth-primary" type="submit" disabled={isSubmitDisabled}>
              {loading
                ? mode === 'login'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          <button className="auth-link" onClick={toggleMode} disabled={loading}>
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button className="auth-secondary" onClick={handleDemoLogin} disabled={loading}>
            {loading ? 'Generating demo token...' : 'Use demo workspace'}
          </button>

          {mode === 'login' && (
            <div className="auth-credentials">
              <div>
                <span>Default credentials</span>
                <p>
                  Email: <strong>admin@optionagents.com</strong>
                </p>
                <p>
                  Password: <strong>admin123</strong>
                </p>
              </div>
            </div>
          )}

          <div className="auth-meta">
            <span>API: {API_BASE}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
