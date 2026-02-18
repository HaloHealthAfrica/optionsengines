const BACKEND_URL = 'https://optionsengines.fly.dev';
const EMAIL = 'test@example.com';
const PASSWORD = 'TestPassword123!';

async function main() {
  const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.error('Login failed:', login);
    process.exit(1);
  }

  const start = Date.now();
  try {
    const r = await fetch(`${BACKEND_URL}/dashboard`, {
      headers: { Authorization: `Bearer ${login.token}` },
      signal: AbortSignal.timeout(60000),
    });
    const elapsed = Date.now() - start;
    console.log(`Status: ${r.status}, Time: ${elapsed}ms`);
    const text = await r.text();
    console.log('Body length:', text.length);
    if (text.length < 500) console.log('Body:', text);
  } catch (e) {
    console.log(`Error after ${Date.now() - start}ms:`, e.message);
  }
}
main();
