import { requireAuth } from '@/lib/request-auth';
import { backendPostBiasRunAdaptive } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendPostBiasRunAdaptive(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Bias run adaptive failed:', error);
    const msg = error?.message || 'Failed to run adaptive tuner';
    const status = error?.status ?? 500;
    return Response.json({ error: msg }, { status });
  }
}
