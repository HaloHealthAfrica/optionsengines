const BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature');
  const contentType = request.headers.get('content-type') || 'application/json';

  const headers = {
    'Content-Type': contentType,
  };

  if (signature) {
    headers['x-webhook-signature'] = signature;
  }

  const response = await fetch(`${BACKEND_URL}/api/webhooks/flow`, {
    method: 'POST',
    headers,
    body: rawBody,
  });

  const responseBody = await response.text();
  const passthrough = new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
  });
  const responseContentType = response.headers.get('content-type');
  if (responseContentType) {
    passthrough.headers.set('content-type', responseContentType);
  }
  return passthrough;
}
