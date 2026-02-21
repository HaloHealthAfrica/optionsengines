import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

/**
 * Write per-agent P&L attribution when a position closes.
 * Each agent that voted on the original signal gets a proportional share
 * of the trade P&L based on its weight and confidence at entry time.
 */
export async function writeAgentAttribution(opts: {
  positionId: string;
  experimentId: string;
  tradePnl: number;
}): Promise<void> {
  const { positionId, experimentId, tradePnl } = opts;

  try {
    const decisionRows = await db.query(
      `SELECT agent_name, agent_type, bias, confidence, metadata
       FROM agent_decisions
       WHERE experiment_id = $1
         AND agent_name != 'meta_decision'
       ORDER BY created_at ASC`,
      [experimentId]
    );

    if (decisionRows.rows.length === 0) {
      logger.debug('No agent decisions found for attribution', { positionId, experimentId });
      return;
    }

    const agents: Array<{
      name: string;
      bias: string;
      confidence: number;
      weight: number;
    }> = [];

    let totalWeightedConfidence = 0;

    for (const row of decisionRows.rows) {
      const metadata = row.metadata || {};
      const weight = Number(metadata.agentWeight ?? metadata.weight ?? 0.10);
      const confidence = Number(row.confidence ?? 0);
      const wc = weight * confidence;
      totalWeightedConfidence += wc;
      agents.push({
        name: row.agent_name,
        bias: row.bias,
        confidence,
        weight,
      });
    }

    if (totalWeightedConfidence === 0) {
      logger.debug('Zero total weighted confidence, skipping attribution', { positionId });
      return;
    }

    for (const agent of agents) {
      const wc = agent.weight * agent.confidence;
      const pnlContribution = (wc / totalWeightedConfidence) * tradePnl;

      await db.query(
        `INSERT INTO agent_trade_attribution
         (position_id, experiment_id, agent_name, agent_bias, agent_confidence, pnl_contribution, trade_pnl, agent_weight_at_entry)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          positionId,
          experimentId,
          agent.name,
          agent.bias,
          agent.confidence,
          Math.round(pnlContribution * 10000) / 10000,
          Math.round(tradePnl * 10000) / 10000,
          agent.weight,
        ]
      );
    }

    logger.info('Agent attribution written', {
      positionId,
      experimentId,
      agentCount: agents.length,
      tradePnl: Math.round(tradePnl * 100) / 100,
    });
  } catch (err) {
    logger.warn('Failed to write agent attribution', { positionId, experimentId, error: err });
  }
}
