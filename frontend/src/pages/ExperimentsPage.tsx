import { useEffect, useState } from 'react';
import { apiGet } from '../services/apiClient';
import type { Experiment } from '../types';

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await apiGet<{ data: Experiment[] }>('/experiments');
        if (!active) return;
        setExperiments(response.data);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <div className="card">Loading experiments...</div>;
  }

  if (error) {
    return <div className="card error">Error: {error}</div>;
  }

  return (
    <section className="card">
      <h2>Experiments</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Signal</th>
            <th>Variant</th>
            <th>Symbol</th>
            <th>Timeframe</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((experiment) => (
            <tr key={experiment.experiment_id}>
              <td>{experiment.experiment_id}</td>
              <td>{experiment.signal_id}</td>
              <td>{experiment.variant}</td>
              <td>{experiment.symbol ?? '-'}</td>
              <td>{experiment.timeframe ?? '-'}</td>
              <td>{new Date(experiment.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {experiments.length === 0 && (
            <tr>
              <td colSpan={6}>No experiments found</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
