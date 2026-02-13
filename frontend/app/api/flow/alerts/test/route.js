import { requireAuth } from '@/lib/request-auth';
import { backendPostFlowAlertsTest } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const token = auth.token;
  try {
    const data = await backendPostFlowAlertsTest(token);
    return Response.json(data);
  } catch (error) {
    console.error('Test alert failed:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Failed to send test alert',
      },
      { status: 500 }
    );
  }
}
