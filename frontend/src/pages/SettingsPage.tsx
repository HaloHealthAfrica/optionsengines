import { useEffect, useState } from 'react';
import { apiGet } from '../services/apiClient';
import FeatureFlagsPage from './FeatureFlagsPage';

type HealthResponse = {
  status: string;
  uptime_seconds: number;
  database?: { ok: boolean };
  cache?: { hitRate?: string };
};

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiGet<HealthResponse>('/health');
        if (!active) return;
        setHealth(response);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError((err as Error).message);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Settings</h2>
          <p className="subtitle">Mode, health, and feature controls.</p>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h3>Trading Mode &amp; Health</h3>
          {error && <div className="error">Error: {error}</div>}
          {!health && !error && <div className="muted">Loading health status...</div>}
          {health && (
            <div className="health-grid">
              <div>
                <span className="stat-label">Status</span>
                <span className={`status-badge ${health.status === 'healthy' ? 'success' : 'warning'}`}>
                  {health.status}
                </span>
              </div>
              <div>
                <span className="stat-label">Uptime</span>
                <span className="stat-value">{Math.round(health.uptime_seconds)}s</span>
              </div>
              <div>
                <span className="stat-label">Database</span>
                <span className={`status-badge ${health.database?.ok ? 'success' : 'warning'}`}>
                  {health.database?.ok ? 'ok' : 'down'}
                </span>
              </div>
              <div>
                <span className="stat-label">Cache Hit Rate</span>
                <span className="stat-value">{health.cache?.hitRate ?? 'n/a'}</span>
              </div>
            </div>
          )}
          <p className="muted">
            Live execution requires both <code>APP_MODE=LIVE</code> and
            <code>ALLOW_LIVE_EXECUTION=true</code>.
          </p>
        </section>

        <section className="card">
          <FeatureFlagsPage />
        </section>
      </div>
    </section>
  );
}
