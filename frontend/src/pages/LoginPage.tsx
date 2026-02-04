import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../services/apiClient';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'register' && password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      
      console.log('Attempting to connect to:', `${API_BASE}${endpoint}`);
      
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      console.log('Response status:', response.status);
      
      const data = await response.json();
      console.log('Response data:', data);

      if (!response.ok) {
        throw new Error(data.error || `${mode === 'login' ? 'Login' : 'Registration'} failed`);
      }

      setToken(data.token);
      navigate('/dashboard');
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
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${API_BASE}/auth/generate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'demo-user',
          email: 'demo@example.com',
          role: 'admin',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate demo token');
      }

      const data = await response.json();
      setToken(data.token);
      navigate('/dashboard');
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

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      padding: '20px',
      background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
    }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
        <h1 style={{ marginBottom: '8px' }}>OptionAgents</h1>
        <p className="subtitle" style={{ marginBottom: '32px' }}>
          Automated options execution + experimentation
        </p>
        
        {error && (
          <div className="card warning" style={{ marginBottom: '20px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === 'login' ? 'admin@optionagents.com' : 'your@email.com'}
              required
              disabled={loading}
              style={{ width: '100%', padding: '10px', fontSize: '14px' }}
            />
          </div>

          <div style={{ marginBottom: mode === 'register' ? '16px' : '24px' }}>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={loading}
              style={{ width: '100%', padding: '10px', fontSize: '14px' }}
            />
          </div>

          {mode === 'register' && (
            <div style={{ marginBottom: '24px' }}>
              <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                disabled={loading}
                style={{ width: '100%', padding: '10px', fontSize: '14px' }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            {loading ? (mode === 'login' ? 'Logging in...' : 'Creating account...') : (mode === 'login' ? 'Login' : 'Sign Up')}
          </button>
        </form>

        <button
          onClick={toggleMode}
          disabled={loading}
          style={{ 
            width: '100%', 
            background: 'transparent',
            border: 'none',
            color: '#60a5fa',
            padding: '8px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Login'}
        </button>

        <div style={{ 
          margin: '24px 0', 
          textAlign: 'center', 
          color: '#64748b',
          fontSize: '14px',
          position: 'relative'
        }}>
          <span style={{ 
            background: '#1e293b', 
            padding: '0 12px',
            position: 'relative',
            zIndex: 1
          }}>
            or
          </span>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: '1px',
            background: '#334155',
            zIndex: 0
          }} />
        </div>

        <button
          onClick={handleDemoLogin}
          disabled={loading}
          style={{ 
            width: '100%', 
            background: '#334155',
            border: '1px solid #475569'
          }}
        >
          {loading ? 'Generating...' : 'Use Demo Token'}
        </button>

        {mode === 'login' && (
          <div style={{ 
            marginTop: '24px', 
            padding: '16px', 
            background: '#0f172a',
            borderRadius: '8px',
            fontSize: '13px'
          }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 500, color: '#94a3b8' }}>
              Default Credentials:
            </p>
            <p style={{ margin: '0', color: '#64748b', fontFamily: 'monospace' }}>
              Email: admin@optionagents.com<br />
              Password: admin123
            </p>
          </div>
        )}

        <div style={{ 
          marginTop: '16px', 
          padding: '12px', 
          background: '#0f172a',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#64748b'
        }}>
          <p style={{ margin: 0 }}>
            API: {import.meta.env.VITE_API_URL || 'http://localhost:3000'}
          </p>
        </div>
      </div>
    </div>
  );
}
