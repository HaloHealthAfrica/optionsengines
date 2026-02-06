export const runtime = 'nodejs';

function validateCsrfToken(request) {
  const cookieHeader = request.headers.get('cookie');
  const cookies = Object.fromEntries(
    (cookieHeader || '').split('; ').map(c => {
      const [key, ...v] = c.split('=');
      return [key, v.join('=')];
    })
  );
  const cookieToken = cookies['csrf_token'];
  const headerToken = request.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

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
