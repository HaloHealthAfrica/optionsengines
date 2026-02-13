/**
 * Alert Service - Sends confluence alerts to Discord/Slack when confluence >= threshold
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getFlowConfigSync } from './flow-config.service.js';
import { db } from './database.service.js';

const lastAlertBySymbol = new Map<string, number>();

function getCooldownMs(): number {
  return (config.alertCooldownMinutes ?? 30) * 60 * 1000;
}

async function sendDiscord(payload: Record<string, unknown>): Promise<boolean> {
  const url = config.discordWebhookUrl;
  if (!url) return false;
  try {
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
  } catch (error) {
    logger.warn('Discord webhook error', { error });
    return false;
  }
}

async function sendSlack(payload: Record<string, unknown>): Promise<boolean> {
  const url = config.slackWebhookUrl;
  if (!url) return false;
  try {
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
  } catch (error) {
    logger.warn('Slack webhook error', { error });
    return false;
  }
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

export const alertService = {
  sendConfluenceAlert,
  sendTestAlert,
};
