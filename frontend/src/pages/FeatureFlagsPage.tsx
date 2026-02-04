import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/apiClient';
import type { FeatureFlag } from '../types';

type UpdateResponse = { status: string; name: string; enabled: boolean };

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadFlags = async () => {
    try {
      setLoading(true);
      const response = await apiGet<{ data: FeatureFlag[] }>('/feature-flags');
      setFlags(response.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlags();
  }, []);

  const toggleFlag = async (flag: FeatureFlag) => {
    setUpdating(flag.name);
    try {
      const response = await apiPost<UpdateResponse>('/feature-flags', {
        name: flag.name,
        enabled: !flag.enabled,
      });
      setFlags((current) =>
        current.map((item) =>
          item.name === response.name ? { ...item, enabled: response.enabled } : item
        )
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return <div className="card">Loading feature flags...</div>;
  }

  return (
    <section>
      <h3>Feature Flags</h3>
      {error && <div className="error">Error: {error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Flag</th>
            <th>Description</th>
            <th>Enabled</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <tr key={flag.flag_id}>
              <td>{flag.name}</td>
              <td>{flag.description ?? '-'}</td>
              <td>
                <button
                  type="button"
                  className={flag.enabled ? 'pill success' : 'pill'}
                  onClick={() => toggleFlag(flag)}
                  disabled={Boolean(updating)}
                >
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </td>
              <td>{new Date(flag.updated_at).toLocaleString()}</td>
            </tr>
          ))}
          {flags.length === 0 && (
            <tr>
              <td colSpan={4}>No flags available</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="muted">Updates require an admin JWT token.</div>
    </section>
  );
}
