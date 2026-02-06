import { signToken, validateCredentials } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { validateCsrfToken } from '@/lib/csrf';

export const runtime = 'edge';

export async function POST(request) {
  const rate = rateLimit({
    key: `login:${request.headers.get('x-forwarded-for') || 'unknown'}`,
    limit: 8,
    windowMs: 5 * 60 * 1000,
  });

  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many login attempts. Please try again later.' },
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

  if (!validateCredentials(email, password)) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signToken({ email, role: 'admin' });

  const response = Response.json({ success: true });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set(
    'Set-Cookie',
    `auth_token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Strict;${
      process.env.NODE_ENV === 'production' ? ' Secure;' : ''
    }`
  );
  return response;
}
