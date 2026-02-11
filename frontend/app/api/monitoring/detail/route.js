import { requireAuth } from '@/lib/request-auth';
import { backendGetMonitoringDetail } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');

  if (!type || !id) {
    return Response.json({ error: 'type and id are required' }, { status: 400 });
  }

  try {
    const data = await backendGetMonitoringDetail(auth.token, type, id);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Backend monitoring detail fetch failed:', error);
    return Response.json({ error: 'Failed to fetch monitoring detail' }, { status: 502 });
  }
}
