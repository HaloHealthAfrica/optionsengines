import { requireAuth } from '@/lib/request-auth';
import { performanceSeries, portfolioMetrics, recentActivity } from '@/lib/mock-data';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const response = Response.json({
    metrics: portfolioMetrics,
    performance: performanceSeries,
    recentActivity,
  });
  response.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return response;
}
