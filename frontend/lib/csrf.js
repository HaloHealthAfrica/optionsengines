import { cookies } from 'next/headers';

export function createCsrfToken() {
  const token = globalThis.crypto.randomUUID();
  const cookieStore = cookies();
  cookieStore.set('csrf_token', token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return token;
}

export function validateCsrfToken(request) {
  const cookieToken = request.cookies.get('csrf_token')?.value;
  const headerToken = request.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}
