import { requireAuth } from '@/lib/request-auth';
import { backendGetTopNetImpact } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await backendGetTopNetImpact(auth.token);
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch top net impact' }, { status: 500 });
  }
}
