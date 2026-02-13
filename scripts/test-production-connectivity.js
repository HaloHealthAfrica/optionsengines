#!/usr/bin/env node
/**
 * Test production connectivity: Vercel frontend -> Fly.io backend
 * Run from project root. Set BACKEND_URL or use default.
 *
 * Usage:
 *   node scripts/test-production-connectivity.js
 *   BACKEND_URL=https://optionsengines.fly.dev node scripts/test-production-connectivity.js
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://optionsengines.fly.dev';

async function test(name, fn) {
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
  console.log(`\nTesting connectivity to ${BACKEND_URL}\n`);

  const results = [];

  results.push(
    await test('GET / (root)', async () => {
      const r = await fetch(BACKEND_URL, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.name) throw new Error('Invalid response');
      return j;
    })
  );

  results.push(
    await test('GET /health', async () => {
      const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
  );

  results.push(
    await test('POST /auth/login (demo)', async () => {
      const r = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@optionagents.ai', password: 'demo' }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        const b = await r.text();
        throw new Error(`HTTP ${r.status}: ${b.slice(0, 100)}`);
      }
      const j = await r.json();
      if (!j.token) throw new Error('No token in response');
      return j;
    })
  );

  const loginResult = results[2];
  if (loginResult.ok && loginResult.result?.token) {
    const token = loginResult.result.token;
    results.push(
      await test('GET /flow/SPY (authenticated)', async () => {
        const r = await fetch(`${BACKEND_URL}/flow/SPY`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j.symbol) throw new Error('Invalid flow response');
        return j;
      })
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n---\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('If flow fails: check Fly.io app is running, DATABASE_URL, UNUSUAL_WHALES_API_KEY.');
    console.log('If login fails: demo user may not exist. Create with create-test-user.js.');
    console.log('\nVercel env: Set NEXT_PUBLIC_API_URL (or API_URL) to', BACKEND_URL);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
