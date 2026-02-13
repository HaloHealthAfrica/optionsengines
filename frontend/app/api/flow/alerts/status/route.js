import { requireAuth } from '@/lib/request-auth';
import { backendGetFlowAlertsStatus } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await backendGetFlowAlertsStatus(auth.token);
    return Response.json(data);
  } catch (error) {
    console.error('Flow alerts status fetch failed:', error);
    return Response.json(
      {
        alertsEnabled: false,
        discordConfigured: false,
        slackConfigured: false,
        confluenceThreshold: 75,
        cooldownMinutes: 30,
      },
      { status: 200 }
    );
  }
}
