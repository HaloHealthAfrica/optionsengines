import { db } from './database.service.js';
import { logger } from '../utils/logger.js';
import type { AgentWeightConfig } from '../types/index.js';

const DEFAULT_WEIGHTS: Record<string, number> = {
  context: 0.12,
  technical: 0.18,
  risk: 0.15,
  regime_classifier: 0.12,
  volatility: 0.10,
  liquidity: 0.08,
  correlation_risk: 0.08,
  mtf_trend: 0.07,
  gamma_flow: 0.10,
  orb_specialist: 0.10,
  strat_specialist: 0.10,
  ttm_specialist: 0.10,
};

const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.35;
const MAX_DAILY_CHANGE = 0.10;
const MIN_TRADES_FOR_SHARPE = 10;

let cachedWeights: Map<string, AgentWeightConfig> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getAgentWeights(): Promise<Map<string, AgentWeightConfig>> {
  if (cachedWeights && Date.now() < cacheExpiry) {
    return cachedWeights;
  }

  const weights = new Map<string, AgentWeightConfig>();

  try {
    const result = await db.query(
      `SELECT agent_name, current_weight, rolling_sharpe, trade_count, updated_at
       FROM agent_weight_config
       WHERE active = true
       ORDER BY agent_name`
    );

    for (const row of result.rows) {
      weights.set(row.agent_name, {
        agentName: row.agent_name,
        weight: Number(row.current_weight),
        rollingSharpe: row.rolling_sharpe != null ? Number(row.rolling_sharpe) : undefined,
        tradeCount: row.trade_count != null ? Number(row.trade_count) : undefined,
        lastUpdated: new Date(row.updated_at),
      });
    }
  } catch {
    logger.debug('agent_weight_config table not available, using defaults');
  }

  for (const [name, defaultWeight] of Object.entries(DEFAULT_WEIGHTS)) {
    if (!weights.has(name)) {
      weights.set(name, {
        agentName: name,
        weight: defaultWeight,
        lastUpdated: new Date(),
      });
    }
  }

  cachedWeights = weights;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return weights;
}

export function getDefaultWeight(agentName: string): number {
  return DEFAULT_WEIGHTS[agentName] ?? 0.10;
}

export async function updateAgentWeightsFromPerformance(): Promise<{
  updated: boolean;
  changes: Array<{ agent: string; oldWeight: number; newWeight: number; sharpe: number }>;
}> {
  const changes: Array<{ agent: string; oldWeight: number; newWeight: number; sharpe: number }> = [];

  try {
    const perf = await db.query(
      `SELECT
         agent_name,
         COUNT(*) as trade_count,
         AVG(pnl_contribution) as avg_pnl,
         STDDEV(pnl_contribution) as std_pnl
       FROM agent_trade_attribution
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY agent_name
       HAVING COUNT(*) >= $1`,
      [MIN_TRADES_FOR_SHARPE]
    );

    if (perf.rows.length === 0) {
      return { updated: false, changes };
    }

    const sharpes: Record<string, number> = {};
    for (const row of perf.rows) {
      const avg = Number(row.avg_pnl) || 0;
      const std = Number(row.std_pnl) || 1;
      sharpes[row.agent_name] = std > 0 ? avg / std : 0;
    }

    const currentWeights = await getAgentWeights();
    const minSharpe = Math.min(...Object.values(sharpes));
    const maxSharpe = Math.max(...Object.values(sharpes));
    const sharpeRange = maxSharpe - minSharpe;

    if (sharpeRange < 0.01) {
      return { updated: false, changes };
    }

    for (const [agent, sharpe] of Object.entries(sharpes)) {
      const current = currentWeights.get(agent);
      if (!current) continue;

      const normalized = (sharpe - minSharpe) / sharpeRange;
      const targetWeight = MIN_WEIGHT + normalized * (MAX_WEIGHT - MIN_WEIGHT);

      const maxChange = current.weight * MAX_DAILY_CHANGE;
      const diff = targetWeight - current.weight;
      const boundedDiff = Math.max(-maxChange, Math.min(maxChange, diff));
      const newWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, current.weight + boundedDiff));

      if (Math.abs(newWeight - current.weight) > 0.001) {
        changes.push({
          agent,
          oldWeight: current.weight,
          newWeight: Math.round(newWeight * 1000) / 1000,
          sharpe: Math.round(sharpe * 1000) / 1000,
        });

        await db.query(
          `INSERT INTO agent_weight_config (agent_name, current_weight, rolling_sharpe, trade_count, active, updated_at)
           VALUES ($1, $2, $3, $4, true, NOW())
           ON CONFLICT (agent_name) DO UPDATE SET
             previous_weight = agent_weight_config.current_weight,
             current_weight = $2,
             rolling_sharpe = $3,
             trade_count = $4,
             updated_at = NOW()`,
          [agent, newWeight, sharpe, Number(perf.rows.find((r: any) => r.agent_name === agent)?.trade_count ?? 0)]
        );
      }
    }

    cachedWeights = null;

    if (changes.length > 0) {
      await db.query(
        `INSERT INTO agent_weight_history (snapshot_json, created_at)
         VALUES ($1, NOW())`,
        [JSON.stringify(changes)]
      );

      logger.info('Agent weights updated from performance', {
        changesCount: changes.length,
        changes: changes.map((c) => `${c.agent}: ${c.oldWeight} → ${c.newWeight}`),
      });
    }

    return { updated: changes.length > 0, changes };
  } catch (err) {
    logger.warn('Failed to update agent weights from performance', { error: err });
    return { updated: false, changes };
  }
}

export function invalidateWeightCache(): void {
  cachedWeights = null;
  cacheExpiry = 0;
}
