#!/usr/bin/env node
/**
 * Diagnose "Data source unavailable" - finds the exact failure point.
 * Run from project root.
 *
 * Usage: node scripts/diagnose-data-source.js
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://optionsengines.fly.dev';
const EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'TestPassword123!';

async function step(name, fn) {
  try {
    const result = await fn();
    console.log(`  ✓ ${name}`);
    return { ok: true, result };
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    return { ok: false, error: err };
  }
}

async function main() {
  console.log('\n=== Data Source Diagnostic ===\n');
  console.log(`Backend: ${BACKEND_URL}\n`);

  // 1. Backend reachable
  const health = await step('Backend /health', async () => {
    const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  if (!health.ok) {
    console.log('\n→ Fix: Ensure backend is deployed (fly deploy -a optionsengines)');
    process.exit(1);
  }

  // 2. Login
  const login = await step('Login', async () => {
    const r = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    if (!data.token) throw new Error('No token in response');
    return data;
  });
  if (!login.ok) {
    console.log('\n→ Fix: Create user first: node create-test-user.js');
    console.log('  Or use existing credentials (TEST_EMAIL, TEST_PASSWORD)');
    process.exit(1);
  }

  const token = login.result.token;

  // 3. Token verification
  const verify = await step('Token verify (/auth/verify-token)', async () => {
    const r = await fetch(`${BACKEND_URL}/auth/verify-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  // 4. Dashboard (60s - Fly.io cold start + DB can be slow)
  const dashboard = await step('Dashboard (/dashboard)', async () => {
    const r = await fetch(`${BACKEND_URL}/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    if (!Array.isArray(data.positions)) throw new Error('Invalid dashboard shape');
    return data;
  });

  console.log('\n--- Summary ---\n');

  if (dashboard.ok) {
    console.log('Backend is fully working. The issue is likely:');
    console.log('  1. Vercel: NEXT_PUBLIC_API_URL not set or wrong → Set to', BACKEND_URL);
    console.log('  2. Vercel: Env change requires redeploy');
    console.log('  3. Auth: You have an OLD token (logged in when backend was down)');
    console.log('     → Log out, then log in again to get a fresh backend token');
    console.log('');
    process.exit(0);
  }

  if (verify.ok && !dashboard.ok) {
    console.log('Token works but /dashboard fails. Check backend logs:');
    console.log('  fly logs -a optionsengines');
    console.log('  (Often DATABASE_URL or Redis connection)');
    process.exit(1);
  }

  console.log('See fixes above for each failed step.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
