import { requireAuth } from '@/lib/request-auth';
import { backendGetMonitoringStatus } from '@/lib/backend-api';
import { monitoringStatus } from '@/lib/mock-data';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 25);

  try {
    const data = await backendGetMonitoringStatus(auth.token, limit);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Backend monitoring fetch failed, using mock data:', error);
    const response = Response.json(monitoringStatus);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
