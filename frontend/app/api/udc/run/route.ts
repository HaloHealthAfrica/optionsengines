import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const response = await backendFetch('/api/udc/run', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      return Response.json(
        { error: error?.error || 'UDC run failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error: any) {
    console.error('[UDC API] Run failed:', error?.message);
    return Response.json(
      { error: 'UDC run failed' },
      { status: 500 },
    );
  }
}
