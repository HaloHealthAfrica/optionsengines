import { requireAuth } from '@/lib/request-auth';
import { backendGetResearchOverview } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await backendGetResearchOverview(auth.token);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Research overview fetch failed:', error);
    return Response.json(
      { rollups: [], drifts: [], context: {} },
      { headers: { 'x-data-source': 'mock' } }
    );
  }
}
