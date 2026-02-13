import { requireAuth } from '@/lib/request-auth';
import { backendGetGamma } from '@/lib/backend-api';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const symbol = params.symbol?.toUpperCase() || 'SPY';
  try {
    const data = await backendGetGamma(auth.token, symbol);
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch gamma context', symbol }, { status: 500 });
  }
}
