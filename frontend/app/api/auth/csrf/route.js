import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const token = globalThis.crypto.randomUUID();
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return NextResponse.json(
    { token },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `csrf_token=${token}; Path=/; SameSite=Strict;${secure}`,
      },
    }
  );
}
