import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../services/apiClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setToken(data.token);
      navigate('/dashboard');
    } catch (err) {
      setError((err as Error).message);
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

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@optionagents.com"
              required
              disabled={loading}
              style={{ width: '100%', padding: '10px', fontSize: '14px' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
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

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

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
      </div>
    </div>
  );
}
