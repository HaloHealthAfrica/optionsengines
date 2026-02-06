import { requireAuth } from '@/lib/request-auth';
import { getOrders } from '@/lib/mock-data';
import { backendGetOrders } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await backendGetOrders(auth.token);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    const response = Response.json({ orders: getOrders() });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
