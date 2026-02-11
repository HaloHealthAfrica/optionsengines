export const runtime = 'nodejs';

export async function GET() {
  const token = globalThis.crypto.randomUUID();
  const response = Response.json({ token });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set(
    'Set-Cookie',
    `csrf_token=${token}; HttpOnly=false; Path=/; SameSite=Strict;${
      process.env.NODE_ENV === 'production' ? ' Secure;' : ''
    }`
  );
  return response;
}
