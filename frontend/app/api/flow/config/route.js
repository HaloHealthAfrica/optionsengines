import { requireAuth } from '@/lib/request-auth';
import { backendGetFlowConfig } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await backendGetFlowConfig(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Flow config fetch failed:', error);
    return Response.json(
      {
        confluenceMinThreshold: 75,
        enableConfluenceGate: true,
        enableConfluenceSizing: true,
        basePositionSize: 1,
      },
      { status: 200 }
    );
  }
}
