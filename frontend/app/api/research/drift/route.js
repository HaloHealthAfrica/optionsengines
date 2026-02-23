import { requireAuth } from '@/lib/request-auth';
import { backendResolveDrift } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { driftId } = await request.json();
    if (!driftId) return Response.json({ error: 'Missing driftId' }, { status: 400 });

    const data = await backendResolveDrift(auth.token, driftId);
    return Response.json(data);
  } catch (error) {
    console.error('Drift resolve failed:', error);
    return Response.json({ error: 'Failed to resolve drift' }, { status: 500 });
  }
}
