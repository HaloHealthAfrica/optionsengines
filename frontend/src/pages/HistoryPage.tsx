import { useEffect, useState } from 'react';
import { apiGet } from '../services/apiClient';
import type { AgentPerformance, Experiment } from '../types';

export default function HistoryPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [agents, setAgents] = useState<AgentPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const [experimentResponse, agentResponse] = await Promise.all([
          apiGet<{ data: Experiment[] }>('/experiments'),
          apiGet<{ data: AgentPerformance[] }>('/agents/performance'),
        ]);
        if (!active) return;
        setExperiments(experimentResponse.data);
        setAgents(agentResponse.data);
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

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>History</h2>
          <p className="subtitle">Performance analytics and experiment tracking.</p>
        </div>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total P&amp;L</span>
          <span className="stat-value muted">n/a</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Win Rate</span>
          <span className="stat-value muted">n/a</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Profit Factor</span>
          <span className="stat-value muted">n/a</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Hold</span>
          <span className="stat-value muted">n/a</span>
        </div>
      </div>

      {loading && <div className="card">Loading performance data...</div>}
      {error && <div className="card error">Error: {error}</div>}

      {!loading && !error && (
        <div className="grid">
          <section className="card">
            <h3>A/B Experiments</h3>
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

          <section className="card">
            <h3>Agent Performance</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Total Signals</th>
                  <th>Approved</th>
                  <th>Rejected</th>
                  <th>Avg Confidence</th>
                  <th>Win Rate</th>
                  <th>Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.performance_id}>
                    <td>{agent.agent_name}</td>
                    <td>{agent.total_signals}</td>
                    <td>{agent.approved_signals}</td>
                    <td>{agent.rejected_signals}</td>
                    <td>{agent.avg_confidence}</td>
                    <td>{agent.win_rate}</td>
                    <td>{agent.expectancy}</td>
                  </tr>
                ))}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={7}>No agent performance data yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </section>
  );
}
