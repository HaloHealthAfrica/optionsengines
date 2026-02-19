/**
 * Alert Service - Sends confluence alerts to Discord/Slack when confluence >= threshold
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getFlowConfigSync } from './flow-config.service.js';
import { db } from './database.service.js';

const lastAlertBySymbol = new Map<string, number>();
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 500;

function getCooldownMs(): number {
  return (config.alertCooldownMinutes ?? 30) * 60 * 1000;
}

/** Retry wrapper with exponential backoff for webhook delivery (Gap 17 fix) */
async function withRetry(
  fn: () => Promise<boolean>,
  label: string,
  maxRetries = MAX_RETRIES,
  initialBackoff = INITIAL_BACKOFF_MS
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ok = await fn();
      if (ok) return true;
      // Non-OK response — worth retrying (might be rate limit)
    } catch (error) {
      logger.warn(`${label} attempt ${attempt + 1} failed`, { error });
    }
    if (attempt < maxRetries) {
      const delay = initialBackoff * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  logger.warn(`${label} failed after ${maxRetries + 1} attempts`);
  return false;
}

async function sendDiscord(payload: Record<string, unknown>): Promise<boolean> {
  const url = config.discordWebhookUrl;
  if (!url) return false;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn('Discord webhook failed', { status: res.status });
      return false;
    }
    return true;
  }, 'Discord webhook');
}

async function sendSlack(payload: Record<string, unknown>): Promise<boolean> {
  const url = config.slackWebhookUrl;
  if (!url) return false;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn('Slack webhook failed', { status: res.status });
      return false;
    }
    return true;
  }, 'Slack webhook');
}

/**
 * Send confluence alert when score >= threshold.
 * Respects cooldown per symbol.
 */
export async function sendConfluenceAlert(params: {
  symbol: string;
  direction: 'long' | 'short';
  confluenceScore: number;
  netflowFormatted: string;
  gammaRegime: string;
  timestamp?: Date;
}): Promise<void> {
  if (!config.alertsEnabled) return;
  const { confluenceMinThreshold } = getFlowConfigSync();
  if (params.confluenceScore < (confluenceMinThreshold ?? 75)) return;

  const now = Date.now();
  const last = lastAlertBySymbol.get(params.symbol) ?? 0;
  if (now - last < getCooldownMs()) {
    logger.debug('Confluence alert skipped (cooldown)', { symbol: params.symbol });
    return;
  }

  const text = `**Confluence Alert** ${params.symbol} | ${params.direction.toUpperCase()} | Score: ${params.confluenceScore} | Netflow: ${params.netflowFormatted} | Gamma: ${params.gammaRegime}`;

  const discordPayload = {
    content: text,
    embeds: [
      {
        title: 'Confluence Alert',
        color: params.confluenceScore >= 80 ? 0x22c55e : 0xeab308,
        fields: [
          { name: 'Symbol', value: params.symbol, inline: true },
          { name: 'Direction', value: params.direction.toUpperCase(), inline: true },
          { name: 'Confluence', value: String(params.confluenceScore), inline: true },
          { name: 'Netflow', value: params.netflowFormatted, inline: true },
          { name: 'Gamma', value: params.gammaRegime, inline: true },
        ],
        timestamp: (params.timestamp ?? new Date()).toISOString(),
      },
    ],
  };

  const slackPayload = {
    text: `Confluence Alert: ${params.symbol} ${params.direction.toUpperCase()} | Score ${params.confluenceScore} | Netflow ${params.netflowFormatted}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Confluence Alert*\n${params.symbol} | ${params.direction.toUpperCase()} | Score: ${params.confluenceScore}\nNetflow: ${params.netflowFormatted} | Gamma: ${params.gammaRegime}`,
        },
      },
    ],
  };

  const [discordOk, slackOk] = await Promise.all([
    sendDiscord(discordPayload),
    sendSlack(slackPayload),
  ]);

  try {
    await db.query(
      `INSERT INTO flow_alerts (symbol, direction, confluence_score, netflow_formatted, gamma_regime, sent_to_discord, sent_to_slack)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.symbol,
        params.direction,
        params.confluenceScore,
        params.netflowFormatted,
        params.gammaRegime,
        discordOk,
        slackOk,
      ]
    );
  } catch (err) {
    logger.warn('Failed to persist flow alert', { error: err });
  }

  lastAlertBySymbol.set(params.symbol, now);
  logger.info('Confluence alert sent', { symbol: params.symbol, score: params.confluenceScore });
}

/**
 * Send a test alert (bypasses cooldown, ignores confluence threshold).
 * Used to verify Discord/Slack webhooks are configured.
 */
export async function sendTestAlert(): Promise<{ discord: boolean; slack: boolean }> {
  const result = { discord: false, slack: false };

  const discordPayload = {
    content: '**OptionAgents Test Alert** — Confluence alerts are configured correctly.',
    embeds: [
      {
        title: 'Test Alert',
        description: 'If you see this, Discord webhooks are working.',
        color: 0x3b82f6,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const slackPayload = {
    text: 'OptionAgents Test Alert — Confluence alerts are configured correctly.',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Test Alert*\nIf you see this, Slack webhooks are working.',
        },
      },
    ],
  };

  if (config.discordWebhookUrl) {
    result.discord = await sendDiscord(discordPayload);
  }
  if (config.slackWebhookUrl) {
    result.slack = await sendSlack(slackPayload);
  }

  logger.info('Test alert sent', result);
  return result;
}

/**
 * Send enrichment audit failure alert (Phase 5).
 * Called when missing refactored_signals exceeds threshold.
 */
export async function sendEnrichmentAlert(params: {
  missingCount: number;
  missingPct: number;
  total: number;
  thresholdPct: number;
  hours: number;
}): Promise<void> {
  if (!config.alertsEnabled) return;

  const text = `**Enrichment Audit FAIL** — ${params.missingCount} missing (${params.missingPct.toFixed(2)}%) of ${params.total} accepted webhooks in last ${params.hours}h. Threshold: ${params.thresholdPct}%. Run \`npm run audit:enrichment\` or \`npx tsx scripts/trace-webhooks.ts <signal_id>\` for details.`;

  const discordPayload = {
    content: text,
    embeds: [
      {
        title: 'Enrichment Coverage Alert',
        color: 0xef4444,
        fields: [
          { name: 'Missing', value: String(params.missingCount), inline: true },
          { name: 'Missing %', value: `${params.missingPct.toFixed(2)}%`, inline: true },
          { name: 'Total', value: String(params.total), inline: true },
          { name: 'Threshold', value: `${params.thresholdPct}%`, inline: true },
          { name: 'Window', value: `${params.hours}h`, inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const slackPayload = {
    text: `Enrichment Audit FAIL: ${params.missingCount} missing (${params.missingPct.toFixed(2)}%) of ${params.total} in last ${params.hours}h. Threshold ${params.thresholdPct}%.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Enrichment Audit FAIL*\nMissing: ${params.missingCount} (${params.missingPct.toFixed(2)}%) of ${params.total} accepted webhooks in last ${params.hours}h. Threshold: ${params.thresholdPct}%.`,
        },
      },
    ],
  };

  await Promise.all([sendDiscord(discordPayload), sendSlack(slackPayload)]);
  logger.info('Enrichment alert sent', { missingCount: params.missingCount, missingPct: params.missingPct });
}

export const alertService = {
  sendConfluenceAlert,
  sendTestAlert,
  sendEnrichmentAlert,
};
