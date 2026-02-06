import { requireAuth } from '@/lib/request-auth';
import { getOrders } from '@/lib/mock-data';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const response = Response.json({ orders: getOrders() });
  response.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return response;
}
