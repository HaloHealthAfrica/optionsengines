import 'dotenv/config';
import crypto from 'crypto';
import { buildWebhookPayload, syntheticScenarios } from './fixtures.js';

type WebhookResponse = {
  status: string;
  signal_id?: string;
  experiment_id?: string;
  variant?: string;
  request_id?: string;
  processing_time_ms?: number;
};

const backendBase = process.env.SYNTHETIC_BACKEND_URL ?? 'http://localhost:3000';
const hmacSecret = process.env.HMAC_SECRET ?? '';
const shouldSign =
  Boolean(hmacSecret) && hmacSecret !== 'change-this-to-another-secure-random-string-for-webhooks';

function signPayload(payload: string): string | null {
  if (!shouldSign) return null;
  const hmac = crypto.createHmac('sha256', hmacSecret);
  hmac.update(payload);
  return hmac.digest('hex');
}

async function postWebhook(payload: unknown): Promise<WebhookResponse> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (signature) {
    headers['x-webhook-signature'] = signature;
  }

  const response = await fetch(`${backendBase}/webhook`, {
    method: 'POST',
    headers,
    body,
  });

  const data = (await response.json().catch(() => ({}))) as WebhookResponse;
  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function run(): Promise<void> {
  const responses: Array<{ id: string; response: WebhookResponse }> = [];

  for (const scenario of syntheticScenarios) {
    const priceSeed = scenario.symbol === 'SPX' ? 4950 : scenario.symbol === 'QQQ' ? 420 : 500;
    const payload = buildWebhookPayload(scenario, priceSeed);
    const response = await postWebhook(payload);
    responses.push({ id: scenario.id, response });
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        total: responses.length,
        backendBase,
        signed: shouldSign,
        responses,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
