import { requireAuth } from '@/lib/request-auth';
import { backendGetDashboard } from '@/lib/backend-api';
import { performanceSeries, portfolioMetrics, recentActivity } from '@/lib/mock-data';

/** Transform backend dashboard shape to frontend-expected format */
function transformBackendDashboard(backend) {
  const positions = backend.positions ?? [];
  const pnlCurve = backend.pnl_curve ?? [];
  const sourcePerf = backend.source_performance ?? [];
  const lastPnl = pnlCurve.length > 0 ? pnlCurve[pnlCurve.length - 1]?.value ?? 0 : 0;
  const prevPnl = pnlCurve.length > 1 ? pnlCurve[pnlCurve.length - 2]?.value ?? 0 : 0;
  const pnlDelta = prevPnl !== 0 ? ((lastPnl - prevPnl) / Math.abs(prevPnl)) * 100 : 0;

  const formatPnl = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '$0';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const metrics = [
    { id: 'total-pnl', label: 'Total P&L', value: formatPnl(lastPnl), delta: `${pnlDelta >= 0 ? '+' : ''}${pnlDelta.toFixed(1)}%`, trend: pnlDelta >= 0 ? 'up' : 'down' },
    { id: 'win-rate', label: 'Win Rate', value: sourcePerf[0] ? `${sourcePerf[0].acceptance_rate ?? 0}%` : '--', delta: '--', trend: 'neutral' },
    { id: 'active-positions', label: 'Active Positions', value: String(positions.length), delta: '--', trend: 'neutral' },
    { id: 'profit-factor', label: 'Profit Factor', value: '--', delta: '--', trend: 'neutral' },
  ];

  const performance = pnlCurve.map((p) => ({
    name: formatChartDate(p.date),
    value: Number(p.value ?? 0),
  }));

  const recentActivity = positions.slice(0, 5).map((p) => {
    const pnl = p.position_pnl_percent ?? p.unrealized_pnl;
    const pnlStr = pnl != null ? (Number(pnl) >= 0 ? `+${Number(pnl).toFixed(1)}%` : `${Number(pnl).toFixed(1)}%`) : '--';
    const time = p.entry_timestamp ? timeAgo(p.entry_timestamp) : '--';
    return {
      symbol: p.symbol ?? '--',
      action: 'Opened',
      time,
      pnl: pnlStr,
      position_id: p.position_id,
      position: p,
    };
  });

  return {
    metrics,
    performance,
    recentActivity,
    positions,
    pnl_curve: pnlCurve,
    source_performance: sourcePerf,
  };
}

function formatChartDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  return `${diffDays} days ago`;
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const backend = await backendGetDashboard(auth.token);
    const data = transformBackendDashboard(backend);

    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Backend dashboard fetch failed, using mock data:', error);

    const response = Response.json({
      metrics: portfolioMetrics.map((m, i) => ({
        ...m,
        id: ['total-pnl', 'win-rate', 'active-positions', 'profit-factor'][i] ?? `metric-${i}`,
      })),
      performance: performanceSeries,
      recentActivity: recentActivity.map((a) => ({ ...a, position_id: null, position: null })),
      positions: [],
      pnl_curve: [],
      source_performance: [],
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
