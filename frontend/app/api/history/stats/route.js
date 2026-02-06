import { requireAuth } from '@/lib/request-auth';
import { historyStats, tradeTimeline, winLossDistribution } from '@/lib/mock-data';
import { backendGetHistoryStats } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await backendGetHistoryStats(auth.token);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    const response = Response.json({
      stats: historyStats,
      timeline: tradeTimeline,
      distribution: winLossDistribution,
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
