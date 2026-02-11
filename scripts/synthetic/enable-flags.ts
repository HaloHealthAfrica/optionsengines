import 'dotenv/config';

const backendBase = process.env.SYNTHETIC_BACKEND_URL ?? 'http://localhost:3000';
const token = process.env.SYNTHETIC_ADMIN_TOKEN ?? '';

const flags = [
  'enable_variant_b',
  'enable_orb_specialist',
  'enable_strat_specialist',
  'enable_ttm_specialist',
  'enable_satyland_subagent',
  'enable_shadow_execution',
] as const;

async function updateFlag(name: string): Promise<void> {
  const response = await fetch(`${backendBase}/feature-flags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, enabled: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update ${name}: ${response.status} ${body}`);
  }
}

async function run(): Promise<void> {
  if (!token) {
    throw new Error('SYNTHETIC_ADMIN_TOKEN is required to update feature flags.');
  }

  for (const flag of flags) {
    await updateFlag(flag);
  }

  // eslint-disable-next-line no-console
  console.log(`Enabled feature flags: ${flags.join(', ')}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
