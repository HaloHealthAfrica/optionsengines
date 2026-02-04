import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../services/apiClient';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleGenerateToken = async () => {
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
        throw new Error('Failed to generate token');
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
      padding: '20px'
    }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
        <h1>OptionAgents</h1>
        <p className="subtitle">Automated options execution + experimentation</p>
        
        {error && (
          <div className="card warning" style={{ marginTop: '20px' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleGenerateToken}
          disabled={loading}
          style={{ marginTop: '20px', width: '100%' }}
        >
          {loading ? 'Generating...' : 'Generate Demo Token'}
        </button>

        <p className="muted" style={{ marginTop: '20px', fontSize: '0.875rem' }}>
          This will generate a demo JWT token for accessing the dashboard.
        </p>
      </div>
    </div>
  );
}
