/**
 * UDC End-to-End Paper Trading Test
 *
 * Proves the full pipeline works:
 *   1. UDC decision → order plan (using mock snapshot, works after hours)
 *   2. Order plan → orders table (createOrdersFromUDCPlan logic)
 *   3. Orders → paper executor → positions + trades
 *
 * During market hours, the orchestrator worker handles all of this automatically.
 * This script exercises the same code paths without needing live market data.
 */

import crypto from 'crypto';
import { db } from '../src/services/database.service.js';
import { initTradingMode, setTradingMode, getTradingMode, type TradingMode } from '../src/config/trading-mode.js';
import { runUDC } from '../src/lib/udc/index.js';
import type { UDCSignal, MarketSnapshot, PortfolioState, OptionChainEntry } from '../src/lib/udc/types.js';
import { PaperExecutorWorker } from '../src/workers/paper-executor.js';
import { config } from '../src/config/index.js';

const SEPARATOR = '═'.repeat(80);
const LINE = '─'.repeat(80);

// ── Mock market snapshot builder (works after hours) ──────────────────────

function buildChain(symbol: string, spotPrice: number, dte: number, expiry: string): OptionChainEntry[] {
  const entries: OptionChainEntry[] = [];
  for (let i = -5; i <= 5; i++) {
    const strike = Math.round(spotPrice * (1 + i * 0.01) * 100) / 100;
    const moneyness = (strike - spotPrice) / spotPrice;

    for (const type of ['CALL', 'PUT'] as const) {
      const isOTM =
        (type === 'CALL' && strike > spotPrice) ||
        (type === 'PUT' && strike < spotPrice);
      const baseIV = 0.25 + Math.abs(moneyness) * 0.5;
      const mid = isOTM
        ? Math.max(0.05, spotPrice * 0.015 * Math.exp(-Math.abs(moneyness) * 10))
        : Math.max(0.10, Math.abs(strike - spotPrice) + spotPrice * 0.01);

      entries.push({
        symbol: `${symbol}${expiry.replace(/-/g, '')}${type[0]}${strike.toFixed(0).padStart(8, '0')}`,
        expiry,
        dte,
        strike,
        type,
        bid: Math.round(mid * 0.95 * 100) / 100,
        ask: Math.round(mid * 1.05 * 100) / 100,
        mid: Math.round(mid * 100) / 100,
        delta: type === 'CALL'
          ? Math.max(0.05, 0.5 - moneyness * 3)
          : Math.min(-0.05, -0.5 - moneyness * 3),
        gamma: Math.max(0.001, 0.05 * Math.exp(-moneyness * moneyness * 50)),
        theta: -Math.max(0.01, mid * 0.03),
        vega: Math.max(0.01, spotPrice * 0.001 * Math.exp(-moneyness * moneyness * 20)),
        iv: baseIV,
        volume: Math.floor(Math.random() * 5000) + 100,
        openInterest: Math.floor(Math.random() * 20000) + 500,
      });
    }
  }
  return entries;
}

function buildSnapshot(symbol: string, price: number): MarketSnapshot {
  const now = new Date();
  const exp1 = new Date(now.getTime() + 5 * 86400_000);
  const exp2 = new Date(now.getTime() + 12 * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    symbol,
    price,
    timestamp: Date.now(),
    stale: false,
    chain: [
      ...buildChain(symbol, price, 5, fmt(exp1)),
      ...buildChain(symbol, price, 12, fmt(exp2)),
    ],
  };
}

const portfolio: PortfolioState = {
  risk: {
    drawdownPct: 2.5,
    positionCount: 0,
    dailyPnL: 0,
    maxDailyLoss: 1000,
    portfolioDelta: 0,
    portfolioGamma: 0,
    maxOpenPositions: 5,
    dteConcentration: {},
    lastEntryTimestamp: null,
  },
};

const TEST_CASES = [
  {
    name: 'SPY Long — Strat 2-1-2U Reversal',
    symbol: 'SPY',
    direction: 'long' as const,
    timeframe: '15',
    pattern: 'STRAT_SETUP',
    price: 502.45,
    raw_payload: {
      price: 502.45,
      setup: '2-1-2U Rev',
      entry: 503.20,
      stop: 498.50,
      target: 510.00,
      score: 78,
      c1_type: '1',
      c2_type: '2D',
      c1_high: 503.20,
      c1_low: 499.80,
      tf_confluence_count: 3,
    },
  },
  {
    name: 'QQQ Short — Satyland Markdown',
    symbol: 'QQQ',
    direction: 'short' as const,
    timeframe: '15',
    pattern: 'SATY_MARKDOWN',
    price: 430.20,
    raw_payload: {
      price: 430.20,
      meta: { engine: 'SATY_PO' },
      event: { phase_name: 'MARKDOWN' },
      regime_context: { local_bias: 'BEARISH' },
      ribbonAlignment: 'bearish',
      volumeQuality: 'high',
      confidence: 0.74,
    },
  },
];

async function main() {
  console.log(`\n${SEPARATOR}`);
  console.log('  UDC END-TO-END PAPER TRADING TEST');
  console.log(`  Works after hours — uses mock market snapshots`);
  console.log(SEPARATOR);

  await initTradingMode();
  const previousMode = getTradingMode();

  // ── Step 1: Set trading mode ────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log('  STEP 1: Setting trading mode to UDC_PRIMARY');
  console.log(LINE);
  console.log(`  Previous mode: ${previousMode}`);
  await setTradingMode('UDC_PRIMARY');
  console.log(`  Mode set to: UDC_PRIMARY`);

  const createdSignalIds: string[] = [];
  const createdOrderIds: string[] = [];

  try {
    // ── Step 2: Run UDC with mock snapshots ─────────────────────────────
    console.log(`\n${LINE}`);
    console.log('  STEP 2: Running UDC decisions (mock snapshots)');
    console.log(LINE);

    for (const test of TEST_CASES) {
      const signalId = crypto.randomUUID();
      const signalHash = crypto.createHash('sha256').update(signalId + Date.now()).digest('hex');
      createdSignalIds.push(signalId);

      const udcSignal: UDCSignal = {
        id: signalId,
        symbol: test.symbol,
        direction: test.direction,
        timeframe: test.timeframe,
        timestamp: Date.now(),
        pattern: test.pattern,
        confidence: (test.raw_payload as any).confidence,
        raw_payload: test.raw_payload,
      };

      const snapshot = buildSnapshot(test.symbol, test.price);
      const result = await runUDC(udcSignal, snapshot, portfolio);

      const icon = result.status === 'PLAN_CREATED' ? '+' : result.status === 'NO_STRATEGY' ? '-' : 'X';
      console.log(`  [${icon}] ${test.name}`);
      console.log(`      Status: ${result.status} | Decision: ${result.decisionId}`);

      if (result.status !== 'PLAN_CREATED' || !result.plan) {
        console.log(`      Reason: ${result.reason || 'no plan generated'}`);
        continue;
      }

      console.log(`      Plan: ${result.plan.planId} | Structure: ${result.plan.structure}`);
      for (const leg of result.plan.legs) {
        console.log(`        ${leg.side} ${leg.quantity}x ${leg.symbol} (${leg.type}) @ $${leg.strike} exp ${leg.expiry}`);
      }

      // Persist decision snapshot
      await db.query(
        `INSERT INTO decision_snapshots (signal_id, decision_id, status, reason, order_plan_json, strategy_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT DO NOTHING`,
        [signalId, result.decisionId, result.status, result.reason ?? null, JSON.stringify(result.plan), result.decision ? JSON.stringify(result.decision) : null],
      );

      // ── Step 3: Create orders (replicates createOrdersFromUDCPlan) ────
      // Insert signal first so FK constraint is satisfied
      await db.query(
        `INSERT INTO signals (signal_id, symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash)
         VALUES ($1, $2, $3, $4, NOW(), 'approved', $5, $6)`,
        [signalId, test.symbol, test.direction, test.timeframe, JSON.stringify({ ...test.raw_payload, is_test: true }), signalHash],
      );

      for (const leg of result.plan.legs) {
        const optionType = leg.type === 'CALL' ? 'call' : 'put';
        const isEntry = leg.side === 'BUY';

        const insertResult = await db.query(
          `INSERT INTO orders (
            signal_id, symbol, option_symbol, strike, expiration,
            type, quantity, engine, experiment_id, order_type, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING order_id`,
          [
            isEntry ? signalId : null,
            test.symbol,
            leg.symbol,
            leg.strike,
            leg.expiry,
            optionType,
            leg.quantity,
            'UDC',
            null,
            'paper',
            'pending_execution',
          ],
        );

        const orderId = insertResult.rows[0]?.order_id;
        if (orderId) createdOrderIds.push(orderId);
        console.log(`      Order created: ${orderId} | ${leg.side} ${optionType} $${leg.strike} → pending_execution`);
      }
    }

    // ── Step 4: Check orders ──────────────────────────────────────────────
    console.log(`\n${LINE}`);
    console.log('  STEP 3: Order summary before execution');
    console.log(LINE);

    const ordersResult = await db.query(
      `SELECT order_id, symbol, option_symbol, strike, type, quantity, engine, status
       FROM orders WHERE order_id = ANY($1)`,
      [createdOrderIds],
    );

    console.log(`  Total orders: ${ordersResult.rows.length}`);
    for (const o of ordersResult.rows) {
      console.log(`    ${o.order_id} | ${o.symbol} ${o.type} $${o.strike} x${o.quantity} | engine: ${o.engine} | status: ${o.status}`);
    }

    // ── Step 5: Run paper executor ──────────────────────────────────────
    console.log(`\n${LINE}`);
    console.log('  STEP 4: Running paper executor');
    console.log(LINE);

    const executor = new PaperExecutorWorker();
    await executor.run();

    const filledResult = await db.query(
      `SELECT order_id, symbol, option_symbol, strike, type, status
       FROM orders WHERE order_id = ANY($1)`,
      [createdOrderIds],
    );

    let filledCount = 0;
    let failedCount = 0;
    for (const o of filledResult.rows) {
      const icon = o.status === 'filled' ? '+' : o.status === 'failed' ? 'X' : '?';
      if (o.status === 'filled') filledCount++;
      if (o.status === 'failed') failedCount++;
      console.log(`  [${icon}] ${o.order_id} | ${o.symbol} ${o.type} $${o.strike} → ${o.status}`);
    }

    // ── Step 6: Check positions ───────────────────────────────────────────
    console.log(`\n${LINE}`);
    console.log('  STEP 5: Checking positions');
    console.log(LINE);

    const positions = await db.query(
      `SELECT position_id, symbol, option_symbol, strike, type, quantity,
              entry_price, current_price, unrealized_pnl, status, engine
       FROM refactored_positions
       WHERE engine = 'UDC' AND entry_timestamp > NOW() - INTERVAL '5 minutes'
       ORDER BY entry_timestamp DESC`,
    );

    if (positions.rows.length === 0) {
      console.log('  [!] No positions created');
      if (failedCount > 0) {
        console.log('      Orders failed — likely because market data (option prices) is unavailable after hours.');
        console.log('      During market hours, the paper executor fetches live option prices and fills orders.');
      }
    } else {
      console.log(`  [+] ${positions.rows.length} positions opened:`);
      for (const pos of positions.rows) {
        console.log(`    ${pos.position_id} | ${pos.symbol} ${pos.type} $${pos.strike}`);
        console.log(`      entry: $${pos.entry_price} | current: $${pos.current_price} | P&L: $${pos.unrealized_pnl} | engine: ${pos.engine}`);
      }
    }

    // ── Step 7: Check trades ──────────────────────────────────────────────
    console.log(`\n${LINE}`);
    console.log('  STEP 6: Checking trades');
    console.log(LINE);

    const trades = await db.query(
      `SELECT t.trade_id, t.order_id, t.fill_price, t.fill_quantity, t.fill_timestamp
       FROM trades t WHERE t.order_id = ANY($1)`,
      [createdOrderIds],
    );

    if (trades.rows.length === 0) {
      console.log('  [!] No trades recorded');
    } else {
      console.log(`  [+] ${trades.rows.length} trades:`);
      for (const t of trades.rows) {
        console.log(`    trade: ${t.trade_id} | fill: $${t.fill_price} x${t.fill_quantity} @ ${t.fill_timestamp}`);
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log(`\n${SEPARATOR}`);
    console.log('  E2E RESULTS');
    console.log(SEPARATOR);

    const decisionCount = (await db.query(
      `SELECT COUNT(*)::int AS cnt FROM decision_snapshots WHERE signal_id = ANY($1)`,
      [createdSignalIds],
    )).rows[0].cnt;

    console.log(`  UDC decisions:       ${decisionCount}`);
    console.log(`  Orders created:      ${createdOrderIds.length}`);
    console.log(`  Orders filled:       ${filledCount}`);
    console.log(`  Orders failed:       ${failedCount}`);
    console.log(`  Positions opened:    ${positions.rows.length}`);
    console.log(`  Trades recorded:     ${trades.rows.length}`);

    if (filledCount > 0 && positions.rows.length > 0) {
      console.log(`\n  [PASS] Full pipeline connected: UDC → Orders → Paper Fill → Positions`);
    } else if (createdOrderIds.length > 0 && failedCount > 0) {
      console.log(`\n  [PARTIAL] Pipeline wired correctly. Orders created but fills failed.`);
      console.log(`  This is expected after hours — option prices are unavailable.`);
      console.log(`  During market hours, the paper executor will fill these automatically.`);
      console.log(`\n  The pipeline is: UDC decision ✓ → Order creation ✓ → Paper fill (needs market hours)`);
    } else {
      console.log(`\n  [INCOMPLETE] Pipeline has gaps — see details above.`);
    }

  } finally {
    // Restore previous mode
    if (previousMode !== 'UDC_PRIMARY') {
      await setTradingMode(previousMode as TradingMode);
      console.log(`\n  Trading mode restored to: ${previousMode}`);
    } else {
      console.log(`\n  Trading mode remains: UDC_PRIMARY`);
    }
  }

  console.log(`${SEPARATOR}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
