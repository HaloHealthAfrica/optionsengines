import { requireAuth } from '@/lib/request-auth';
import { backendGetDashboard } from '@/lib/backend-api';
import { performanceSeries, portfolioMetrics, recentActivity } from '@/lib/mock-data';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Try to fetch from backend
    const data = await backendGetDashboard(auth.token);
    
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Backend dashboard fetch failed, using mock data:', error);
    
    // Fallback to mock data if backend is unavailable
    const response = Response.json({
      metrics: portfolioMetrics,
      performance: performanceSeries,
      recentActivity,
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
