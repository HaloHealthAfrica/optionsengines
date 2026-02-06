import { validateCsrfToken } from '@/lib/csrf';

export const runtime = 'edge';

export async function POST(request) {
  if (!validateCsrfToken(request)) {
    return Response.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const response = Response.json({ success: true });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set(
    'Set-Cookie',
    `auth_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict;${
      process.env.NODE_ENV === 'production' ? ' Secure;' : ''
    }`
  );
  return response;
}
