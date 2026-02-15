import { requireAuth } from '@/lib/request-auth';
import { backendGetBiasAdaptiveStatus } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendGetBiasAdaptiveStatus(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Bias adaptive status fetch failed:', error);
    return Response.json({ error: 'Failed to fetch adaptive status' }, { status: 500 });
  }
}
