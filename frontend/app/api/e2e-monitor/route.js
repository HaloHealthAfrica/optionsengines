import { requireAuth } from '@/lib/request-auth';
import { backendGetE2EMonitor } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 20);
  const windowHours = Number(searchParams.get('windowHours') || 24);

  try {
    const data = await backendGetE2EMonitor(auth.token, limit, windowHours);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('E2E monitor fetch failed:', error);
    return Response.json(
      {
        error: 'Failed to fetch E2E monitor data',
        e2e_test_mode: false,
        webhooks: [],
        bias_state: [],
        pnl: { total: 0, wins: 0, losses: 0, closed_count: 0, win_rate: 0 },
        recent_closed: [],
      },
      { status: 500 }
    );
  }
}
