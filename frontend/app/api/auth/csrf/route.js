import { createCsrfToken } from '@/lib/csrf';

export async function GET() {
  const token = createCsrfToken();
  const response = Response.json({ token });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
