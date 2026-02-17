/**
 * Scoring Tuner - Adjusts strat scanner weights based on outcome data
 */

import { db } from '../database.service.js';

const INITIAL_WEIGHTS: Record<string, number> = {
  patternQuality: 0.25,
  riskReward: 0.2,
  tfConfluence: 0.2,
  rvol: 0.15,
  candleShape: 0.1,
  atrContext: 0.1,
};

function calcWinRate(arr: Record<string, unknown>[]): number {
  const resolved = arr.filter((o) =>
    ['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))
  );
  if (resolved.length === 0) return 0;
  return resolved.filter((o) => o.outcome === 'target_hit').length / resolved.length;
}

export interface TuningResult {
  status: 'tuned' | 'insufficient_data';
  message?: string;
  previousWeights?: Record<string, number>;
  newWeights?: Record<string, number>;
  factorAnalysis?: Record<string, { predictivePower: number }>;
  sampleSize?: number;
}

export async function tuneWeights(): Promise<TuningResult> {
  const result = await db.query(
    `SELECT * FROM alert_outcomes
     WHERE outcome IN ('target_hit', 'stop_hit')
     ORDER BY created_at DESC
     LIMIT 500`
  );
  const outcomes = result.rows as Record<string, unknown>[];

  if (outcomes.length < 50) {
    return {
      status: 'insufficient_data',
      message: `Need 50+ outcomes to tune, have ${outcomes.length}`,
    };
  }

  const factors: Record<string, { predictivePower: number }> = {};

  const highConfluence = outcomes.filter(
    (o) => Number(o.tf_confluence_count ?? 0) >= 3
  );
  const lowConfluence = outcomes.filter(
    (o) => Number(o.tf_confluence_count ?? 0) <= 1
  );
  factors.tfConfluence = {
    predictivePower: Math.abs(calcWinRate(highConfluence) - calcWinRate(lowConfluence)),
  };

  const highRvol = outcomes.filter(
    (o) => parseFloat(String(o.rvol ?? '0')) > 20
  );
  const lowRvol = outcomes.filter(
    (o) => parseFloat(String(o.rvol ?? '0')) <= 0
  );
  factors.rvol = {
    predictivePower: Math.abs(calcWinRate(highRvol) - calcWinRate(lowRvol)),
  };

  const highRR = outcomes.filter(
    (o) => Number(o.predicted_rr ?? 0) >= 2
  );
  const lowRR = outcomes.filter(
    (o) => Number(o.predicted_rr ?? 0) < 1.5
  );
  factors.riskReward = {
    predictivePower: Math.abs(calcWinRate(highRR) - calcWinRate(lowRR)),
  };

  const strongShapes = outcomes.filter(
    (o) =>
      (['hammer', 'bullish engulfing', 'bullish marubozu'].includes(
        String(o.c1_shape ?? '')
      ) &&
        o.direction === 'Long') ||
      (['shooting star', 'bearish engulfing', 'bearish marubozu'].includes(
        String(o.c1_shape ?? '')
      ) &&
        o.direction === 'Short')
  );
  const weakShapes = outcomes.filter((o) =>
    ['doji', 'spinning top'].includes(String(o.c1_shape ?? ''))
  );
  factors.candleShape = {
    predictivePower: Math.abs(calcWinRate(strongShapes) - calcWinRate(weakShapes)),
  };

  const reversals = outcomes.filter((o) =>
    String(o.setup_type ?? '').includes('Rev')
  );
  const continuations = outcomes.filter((o) =>
    String(o.setup_type ?? '').includes('Cont')
  );
  factors.patternQuality = {
    predictivePower: Math.abs(
      calcWinRate(reversals) - calcWinRate(continuations)
    ),
  };

  factors.atrContext = { predictivePower: 0.05 };

  const totalPower = Object.values(factors).reduce(
    (s, f) => s + f.predictivePower,
    0
  );
  const newWeightsRaw: Record<string, number> = {};
  for (const [k, v] of Object.entries(factors)) {
    newWeightsRaw[k] = totalPower > 0 ? v.predictivePower / totalPower : INITIAL_WEIGHTS[k] ?? 0.1;
  }

  const currentRow = await db
    .query(
      `SELECT weights FROM strat_scoring_weights ORDER BY updated_at DESC LIMIT 1`
    )
    .then((r) => r.rows[0]);
  const currentWeights = (currentRow?.weights as Record<string, number>) ?? INITIAL_WEIGHTS;

  const blendRate = 0.3;
  const blended: Record<string, number> = {};
  for (const factor of Object.keys(INITIAL_WEIGHTS)) {
    blended[factor] =
      (currentWeights[factor] ?? INITIAL_WEIGHTS[factor]) * (1 - blendRate) +
      (newWeightsRaw[factor] ?? currentWeights[factor] ?? INITIAL_WEIGHTS[factor]) *
        blendRate;
  }
  const sum = Object.values(blended).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(blended)) {
    blended[k] /= sum;
  }

  await db.query(
    `INSERT INTO strat_scoring_weights (weights) VALUES ($1)`,
    [JSON.stringify(blended)]
  );

  await db.query(
    `INSERT INTO scoring_weight_history (previous_weights, new_weights, sample_size, factors_analysis)
     VALUES ($1, $2, $3, $4)`,
    [
      JSON.stringify(currentWeights),
      JSON.stringify(blended),
      outcomes.length,
      JSON.stringify(factors),
    ]
  );

  return {
    status: 'tuned',
    previousWeights: currentWeights,
    newWeights: blended,
    factorAnalysis: factors,
    sampleSize: outcomes.length,
  };
}
