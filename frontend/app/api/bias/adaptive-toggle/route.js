import { requireAuth } from '@/lib/request-auth';
import { backendPostBiasAdaptiveToggle } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const data = await backendPostBiasAdaptiveToggle(auth.token, body.enabled);
    return Response.json(data);
  } catch (error) {
    console.error('Bias adaptive toggle failed:', error);
    return Response.json({ error: 'Failed to update adaptive toggle' }, { status: 500 });
  }
}
