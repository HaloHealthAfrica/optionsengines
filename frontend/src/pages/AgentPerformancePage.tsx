import { useEffect, useState } from 'react';
import { apiGet } from '../services/apiClient';
import type { AgentPerformance } from '../types';

export default function AgentPerformancePage() {
  const [agents, setAgents] = useState<AgentPerformance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await apiGet<{ data: AgentPerformance[] }>('/agents/performance');
        if (!active) return;
        setAgents(response.data);
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
    return <div className="card">Loading agent performance...</div>;
  }

  if (error) {
    return <div className="card error">Error: {error}</div>;
  }

  return (
    <section className="card">
      <h2>Agent Performance</h2>
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
  );
}
