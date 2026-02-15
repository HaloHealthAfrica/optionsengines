import { requireAuth } from '@/lib/request-auth';
import { backendGetBiasAdaptiveParams } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendGetBiasAdaptiveParams(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Bias adaptive params fetch failed:', error);
    return Response.json({ error: 'Failed to fetch adaptive params' }, { status: 500 });
  }
}
