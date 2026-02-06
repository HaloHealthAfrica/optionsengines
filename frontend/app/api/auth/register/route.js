import { backendRegister } from '@/lib/backend-api';
import { rateLimit } from '@/lib/rate-limit';

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
  try {
    const rate = rateLimit({
      key: `register:${request.headers.get('x-forwarded-for') || 'unknown'}`,
      limit: 5,
      windowMs: 5 * 60 * 1000,
    });

    if (!rate.allowed) {
      return Response.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!validateCsrfToken(request)) {
      return Response.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const result = await backendRegister(email, password);
    if (result?.success && result?.token) {
      const response = Response.json({ success: true, mode: 'backend' });
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set(
        'Set-Cookie',
        `auth_token=${result.token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Strict;${
          process.env.NODE_ENV === 'production' ? ' Secure;' : ''
        }`
      );
      return response;
    }

    return Response.json({ error: 'Registration failed' }, { status: 400 });
  } catch (error) {
    console.error('[Register] Error:', error);
    const message = error?.message || 'Registration failed. Please try again.';
    const status =
      message.includes('Backend fetch failed') ? 502 : Number(error?.status) || 500;
    const hint = message.includes('Backend fetch failed')
      ? 'Backend unreachable. Check NEXT_PUBLIC_API_URL and backend uptime.'
      : error?.payload?.error
      ? undefined
      : 'Backend returned an unexpected response.';
    return Response.json({ error: message, hint }, { status });
  }
}
