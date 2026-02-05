import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../services/apiClient';
import type { Position, ShadowPosition } from '../types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type DashboardData = {
  positions: Position[];
  shadowPositions: ShadowPosition[];
};

type HealthResponse = {
  status: string;
  uptime_seconds: number;
  database?: { ok: boolean };
  cache?: { hitRate?: string };
};

type ExitSignal = {
  id: string;
  symbol: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  created_at: string;
  status: 'active' | 'acknowledged';
};

type QueuedSignal = {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  queued_at: string;
};

type SourcePerformance = {
  source: string;
  acceptance_rate: number;
  win_rate: number;
  avg_confidence: number;
  weight: number;
};

type GexLevel = {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
};

type GexData = {
  symbol: string;
  netGex: number;
  totalCallGex: number;
  totalPutGex: number;
  zeroGammaLevel?: number;
  dealerPosition: string;
  volatilityExpectation: string;
  updatedAt: string;
  levels: GexLevel[];
};

type PnlPoint = {
  date: string;
  value: number;
};

type EndpointStatus = 'live' | 'error';

type DataMapItem = {
  label: string;
  endpoint: string;
  status: EndpointStatus;
};

function formatMinutesAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  return `${minutes}m ago`;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({ positions: [], shadowPositions: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [exitSignals, setExitSignals] = useState<ExitSignal[]>([]);
  const [queuedSignals, setQueuedSignals] = useState<QueuedSignal[]>([]);
  const [sourcePerformance, setSourcePerformance] = useState<SourcePerformance[]>([]);
  const [gex, setGex] = useState<GexData | null>(null);
  const [pnlCurve, setPnlCurve] = useState<PnlPoint[]>([]);
  const [dailyReturns, setDailyReturns] = useState<PnlPoint[]>([]);
  const [dataMap, setDataMap] = useState<DataMapItem[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        
        // Use aggregated dashboard endpoint for better performance
        const response = await apiGet<{
          positions: Position[];
          shadow_positions: ShadowPosition[];
          health: HealthResponse;
          exit_signals: ExitSignal[];
          queued_signals: QueuedSignal[];
          source_performance: SourcePerformance[];
          gex: GexData | null;
          pnl_curve: PnlPoint[];
          daily_returns: PnlPoint[];
          metadata: {
            response_time_ms: number;
            cache_hits: string[];
            cache_misses: string[];
            timestamp: string;
          };
          errors?: Record<string, string>;
        }>('/dashboard');

        if (!active) return;

        const positions = response.positions || [];
        const shadowPositions = response.shadow_positions || [];
        const healthResponse = response.health || null;
        const exitResponse = response.exit_signals || [];
        const queueResponse = response.queued_signals || [];
        const sourceResponse = response.source_performance || [];
        const gexResponse = response.gex || null;
        const pnlResponse = response.pnl_curve || [];
        const dailyResponse = response.daily_returns || [];

        const errors = response.errors || {};
        const map: DataMapItem[] = [
          { label: 'Exit Signals', endpoint: '/exit-signals', status: errors.exit_signals ? 'error' : 'live' },
          { label: 'Signal Queue', endpoint: '/signals?status=queued', status: errors.queued_signals ? 'error' : 'live' },
          { label: 'Source Performance', endpoint: '/signals/sources/performance', status: errors.source_performance ? 'error' : 'live' },
          { label: 'GEX', endpoint: '/positioning/gex?symbol=SPY', status: errors.gex ? 'error' : 'live' },
          { label: 'P&L Curve', endpoint: '/analytics/pnl-curve', status: errors.pnl_curve ? 'error' : 'live' },
          { label: 'Daily Returns', endpoint: '/analytics/daily-returns', status: errors.daily_returns ? 'error' : 'live' },
        ];

        setData({ positions, shadowPositions });
        setHealth(healthResponse);
        setExitSignals(exitResponse);
        setQueuedSignals(queueResponse);
        setSourcePerformance(sourceResponse);
        setGex(gexResponse);
        setPnlCurve(pnlResponse);
        setDailyReturns(dailyResponse);
        setDataMap(map);

        const hasErrors = Object.keys(errors).length > 0;
        setError(hasErrors ? 'Some data sections are unavailable. Check the data map.' : null);

        // Log performance metrics in development
        if (import.meta.env.DEV) {
          console.log('Dashboard loaded:', {
            responseTime: `${response.metadata.response_time_ms}ms`,
            cacheHits: response.metadata.cache_hits,
            cacheMisses: response.metadata.cache_misses,
          });
        }
      } catch (err) {
        if (!active) return;
        setError((err as Error).message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const hasErrors = useMemo(() => dataMap.some((item) => item.status === 'error'), [dataMap]);

  if (loading) {
    return <div className="card">Loading dashboard...</div>;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p className="subtitle">Real-time system overview and positions.</p>
        </div>
      </header>

      {error && <div className="card warning">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Open Positions</span>
          <span className="stat-value">{data.positions.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Shadow Positions</span>
          <span className="stat-value">{data.shadowPositions.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Mode</span>
          <span className="stat-value muted">PAPER</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Health</span>
          <span className={`status-badge ${health?.status === 'healthy' ? 'success' : 'warning'}`}>
            {health?.status ?? 'unknown'}
          </span>
        </div>
      </div>

      {hasErrors && (
        <div className="card warning">
          Some panels failed to load. Check the data map for endpoint status.
        </div>
      )}

      <div className="grid panels-grid">
        <section className="card">
          <h2>Gamma Exposure (GEX)</h2>
          {gex ? (
            <>
              <div className="metric-list">
                <div>
                  <span className="stat-label">Net GEX</span>
                  <span className="stat-value">{Math.round(gex.netGex)}</span>
                </div>
                <div>
                  <span className="stat-label">Zero Gamma</span>
                  <span className="stat-value">{gex.zeroGammaLevel ?? 'n/a'}</span>
                </div>
                <div>
                  <span className="stat-label">Dealer Position</span>
                  <span className="stat-value">{gex.dealerPosition}</span>
                </div>
                <div>
                  <span className="stat-label">Volatility</span>
                  <span className="stat-value">{gex.volatilityExpectation}</span>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Strike</th>
                    <th>Net GEX</th>
                  </tr>
                </thead>
                <tbody>
                  {gex.levels.slice(0, 5).map((level) => (
                    <tr key={level.strike}>
                      <td>{level.strike}</td>
                      <td>{Math.round(level.netGex)}</td>
                    </tr>
                  ))}
                  {gex.levels.length === 0 && (
                    <tr>
                      <td colSpan={2}>No GEX levels returned</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div className="muted">GEX data unavailable.</div>
          )}
        </section>
        <section className="card">
          <h2>Exit Signals</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {exitSignals.map((signal) => (
                <tr key={signal.id}>
                  <td>{signal.symbol}</td>
                  <td>{signal.reason}</td>
                  <td>
                    <span className={`badge ${signal.severity}`}>{signal.severity}</span>
                  </td>
                  <td>{formatMinutesAgo(signal.created_at)}</td>
                </tr>
              ))}
              {exitSignals.length === 0 && (
                <tr>
                  <td colSpan={4}>No active exit signals</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Signal Queue</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Timeframe</th>
                <th>Queued</th>
              </tr>
            </thead>
            <tbody>
              {queuedSignals.map((signal) => (
                <tr key={signal.id}>
                  <td>{signal.symbol}</td>
                  <td className={signal.direction === 'long' ? 'positive' : 'negative'}>
                    {signal.direction.toUpperCase()}
                  </td>
                  <td>{signal.timeframe}</td>
                  <td>{formatMinutesAgo(signal.queued_at)}</td>
                </tr>
              ))}
              {queuedSignals.length === 0 && (
                <tr>
                  <td colSpan={4}>No queued signals</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Source Performance</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Acceptance</th>
                <th>Win Rate</th>
                <th>Avg Confidence</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {sourcePerformance.map((source) => (
                <tr key={source.source}>
                  <td>{source.source}</td>
                  <td>{source.acceptance_rate}%</td>
                  <td>{source.win_rate}%</td>
                  <td>{source.avg_confidence}%</td>
                  <td>{Math.round(source.weight * 100)}%</td>
                </tr>
              ))}
              {sourcePerformance.length === 0 && (
                <tr>
                  <td colSpan={5}>No source metrics yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid chart-grid">
        <section className="card">
          <h2>Cumulative P&amp;L</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={pnlCurve}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} />
                <YAxis />
                <Tooltip labelFormatter={(value) => formatShortDate(value as string)} />
                <Line type="monotone" dataKey="value" stroke="#1d4ed8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2>Daily Returns</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyReturns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} />
                <YAxis />
                <Tooltip labelFormatter={(value) => formatShortDate(value as string)} />
                <Bar dataKey="value" fill="#38bdf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Data Map</h2>
        <div className="data-map">
              {dataMap.map((item) => (
            <div key={item.label} className="data-map-row">
              <div>
                <div className="data-map-label">{item.label}</div>
                <div className="muted">{item.endpoint}</div>
              </div>
                  <span className={`status-badge ${item.status === 'live' ? 'success' : 'warning'}`}>
                    {item.status === 'live' ? 'LIVE' : 'ERROR'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <h2>Engine 1 Positions</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Option</th>
                <th>Status</th>
                <th>Entry</th>
                <th>Current</th>
                <th>Unrealized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((position) => (
                <tr key={position.position_id}>
                  <td>{position.symbol}</td>
                  <td>{position.option_symbol}</td>
                  <td>{position.status}</td>
                  <td>{position.entry_price}</td>
                  <td>{position.current_price ?? '-'}</td>
                  <td>{position.unrealized_pnl ?? '-'}</td>
                </tr>
              ))}
              {data.positions.length === 0 && (
                <tr>
                  <td colSpan={6}>No open positions</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Engine 2 Shadow Positions</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Option</th>
                <th>Status</th>
                <th>Entry</th>
                <th>Current</th>
                <th>Unrealized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {data.shadowPositions.map((position) => (
                <tr key={position.shadow_position_id}>
                  <td>{position.symbol}</td>
                  <td>{position.option_symbol}</td>
                  <td>{position.status}</td>
                  <td>{position.entry_price}</td>
                  <td>{position.current_price ?? '-'}</td>
                  <td>{position.unrealized_pnl ?? '-'}</td>
                </tr>
              ))}
              {data.shadowPositions.length === 0 && (
                <tr>
                  <td colSpan={6}>No open shadow positions</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
