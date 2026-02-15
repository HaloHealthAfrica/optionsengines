import { requireAuth } from '@/lib/request-auth';
import { backendGetBiasAdaptiveHistory } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendGetBiasAdaptiveHistory(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Bias adaptive history fetch failed:', error);
    return Response.json({ error: 'Failed to fetch adaptive history' }, { status: 500 });
  }
}
