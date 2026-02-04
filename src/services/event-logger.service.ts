// Event Logger - append-only logging of agent decisions
import { db } from './database.service.js';
import { AgentOutput, MetaDecision } from '../types/index.js';

export interface DecisionLogInput {
  experimentId: string;
  signalId: string;
  outputs: AgentOutput[];
  metaDecision: MetaDecision;
}

export interface ReplayDecisionResult {
  outputs: AgentOutput[];
  metaDecision: MetaDecision | null;
}

export class EventLogger {
  async logDecision(input: DecisionLogInput): Promise<void> {
    for (const output of input.outputs) {
      await db.query(
        `INSERT INTO agent_decisions (
          experiment_id,
          signal_id,
          agent_name,
          agent_type,
          bias,
          confidence,
          reasons,
          block,
          metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.experimentId,
          input.signalId,
          output.agent,
          output.metadata?.agentType || 'core',
          output.bias,
          output.confidence,
          JSON.stringify(output.reasons),
          output.block,
          JSON.stringify(output.metadata || {}),
        ]
      );
    }

    await db.query(
      `INSERT INTO agent_decisions (
        experiment_id,
        signal_id,
        agent_name,
        agent_type,
        bias,
        confidence,
        reasons,
        block,
        metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.experimentId,
        input.signalId,
        'meta_decision',
        'core',
        input.metaDecision.finalBias,
        input.metaDecision.finalConfidence,
        JSON.stringify(input.metaDecision.reasons),
        input.metaDecision.decision === 'reject',
        JSON.stringify({
          contributingAgents: input.metaDecision.contributingAgents,
          consensusStrength: input.metaDecision.consensusStrength,
        }),
      ]
    );
  }

  async replayDecision(experimentId: string, signalId: string): Promise<ReplayDecisionResult> {
    const result = await db.query(
      `SELECT agent_name, agent_type, bias, confidence, reasons, block, metadata
       FROM agent_decisions
       WHERE experiment_id = $1 AND signal_id = $2
       ORDER BY created_at ASC`,
      [experimentId, signalId]
    );

    const outputs: AgentOutput[] = [];
    let metaDecision: MetaDecision | null = null;

    for (const row of result.rows) {
      if (row.agent_name === 'meta_decision') {
        const metadata = row.metadata || {};
        metaDecision = {
          finalBias: row.bias,
          finalConfidence: row.confidence,
          contributingAgents: metadata.contributingAgents || [],
          consensusStrength: metadata.consensusStrength || 0,
          decision: row.block ? 'reject' : 'approve',
          reasons: row.reasons || [],
        };
        continue;
      }

      outputs.push({
        agent: row.agent_name,
        bias: row.bias,
        confidence: row.confidence,
        reasons: row.reasons || [],
        block: row.block,
        metadata: {
          ...(row.metadata || {}),
          agentType: row.agent_type || 'core',
        },
      });
    }

    return { outputs, metaDecision };
  }
}

export const eventLogger = new EventLogger();
