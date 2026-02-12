import { db } from '../../../src/services/database.service.js';

export type SignalStage =
  | 'RECEIVED'
  | 'ENRICHED'
  | 'ENGINE_EVALUATED'
  | 'ORDER_CREATED'
  | 'ORDER_FILLED'
  | 'POSITION_CREATED'
  | 'EXIT_CREATED'
  | 'EXIT_FILLED'
  | 'SHADOW_EXECUTED';

export type LifecycleState = {
  signal: any | null;
  experiment: any | null;
  recommendations: any[];
  orders: any[];
  trades: any[];
  positions: any[];
  exitOrders: any[];
  shadowTrades: any[];
  marketContext: any | null;
};

const stageOrder: SignalStage[] = [
  'RECEIVED',
  'ENRICHED',
  'ENGINE_EVALUATED',
  'ORDER_CREATED',
  'ORDER_FILLED',
  'POSITION_CREATED',
  'EXIT_CREATED',
  'EXIT_FILLED',
  'SHADOW_EXECUTED',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchLifecycleState(signalId: string): Promise<LifecycleState> {
  const signalResult = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, status, processed, created_at
     FROM signals WHERE signal_id = $1`,
    [signalId]
  );
  const signal = signalResult.rows[0] || null;

  const experimentResult = await db.query(
    `SELECT experiment_id, variant, created_at FROM experiments WHERE signal_id = $1`,
    [signalId]
  );
  const experiment = experimentResult.rows[0] || null;

  const marketContextResult = await db.query(
    `SELECT context_id, created_at FROM market_contexts WHERE signal_id = $1`,
    [signalId]
  );
  const marketContext = marketContextResult.rows[0] || null;

  const recommendationsResult = await db.query(
    `SELECT recommendation_id, engine, is_shadow, created_at
     FROM decision_recommendations WHERE signal_id = $1`,
    [signalId]
  );
  const recommendations = recommendationsResult.rows || [];

  const ordersResult = await db.query(
    `SELECT order_id, option_symbol, status, engine, created_at
     FROM orders WHERE signal_id = $1`,
    [signalId]
  );
  const orders = ordersResult.rows || [];
  const orderIds = orders.map((row) => row.order_id);
  const optionSymbols = orders.map((row) => row.option_symbol).filter(Boolean);

  const trades = orderIds.length
    ? (await db.query(
        `SELECT trade_id, order_id, fill_timestamp FROM trades WHERE order_id = ANY($1::uuid[])`,
        [orderIds]
      )).rows
    : [];

  const positions = optionSymbols.length
    ? (await db.query(
        `SELECT position_id, option_symbol, status, exit_timestamp
         FROM refactored_positions WHERE option_symbol = ANY($1::text[])`,
        [optionSymbols]
      )).rows
    : [];

  const exitOrders = optionSymbols.length
    ? (await db.query(
        `SELECT order_id, option_symbol, status, created_at
         FROM orders
         WHERE signal_id IS NULL AND option_symbol = ANY($1::text[])`,
        [optionSymbols]
      )).rows
    : [];

  const shadowTrades = (await db.query(
    `SELECT shadow_trade_id, signal_id, entry_timestamp
     FROM shadow_trades WHERE signal_id = $1`,
    [signalId]
  )).rows;

  return {
    signal,
    experiment,
    recommendations,
    orders,
    trades,
    positions,
    exitOrders,
    shadowTrades,
    marketContext,
  };
}

export function computeStages(state: LifecycleState): SignalStage[] {
  const stages: SignalStage[] = [];
  if (state.signal) stages.push('RECEIVED');
  if (state.marketContext) stages.push('ENRICHED');
  if (state.recommendations.length > 0) stages.push('ENGINE_EVALUATED');
  if (state.orders.length > 0) stages.push('ORDER_CREATED');
  if (state.trades.length > 0) stages.push('ORDER_FILLED');
  if (state.positions.length > 0) stages.push('POSITION_CREATED');
  if (state.exitOrders.length > 0 || state.positions.some((p) => p.status === 'closing')) {
    stages.push('EXIT_CREATED');
  }
  if (state.positions.some((p) => p.status === 'closed')) stages.push('EXIT_FILLED');
  if (state.shadowTrades.length > 0) stages.push('SHADOW_EXECUTED');
  return stages;
}

export async function waitForStage(
  signalId: string,
  stage: SignalStage,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<{ state: LifecycleState; stages: SignalStage[] }> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await fetchLifecycleState(signalId);
    const stages = computeStages(state);
    if (stages.includes(stage)) {
      return { state, stages };
    }
    await sleep(pollMs);
  }

  const state = await fetchLifecycleState(signalId);
  const stages = computeStages(state);
  throw new Error(
    `Timeout waiting for stage ${stage}. Completed: ${stages.join(', ') || 'none'}`
  );
}

export function formatStageReport(signalId: string, stages: SignalStage[]): string {
  const orderedStages = stageOrder.filter((stage) => stages.includes(stage));
  return [
    `Signal ID: ${signalId}`,
    'Stages Completed:',
    ...orderedStages.map((stage) => `✔ ${stage}`),
  ].join('\n');
}
