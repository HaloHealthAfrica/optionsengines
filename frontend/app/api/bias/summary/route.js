import { requireAuth } from '@/lib/request-auth';
import { backendGetBiasSummary } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendGetBiasSummary(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Bias summary fetch failed:', error);
    return Response.json({ error: 'Failed to fetch bias summary' }, { status: 500 });
  }
}
