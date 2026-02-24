/**
 * Direct UDC Test — calls runUDC() with realistic mock data
 * to see exactly how the Unified Decision Core processes signals.
 * Bypasses the slow enrichment pipeline (unusable afterhours).
 */

import { runUDC } from '../src/lib/udc/index.js';
import { db } from '../src/services/database.service.js';
import { initTradingMode, getTradingMode } from '../src/config/trading-mode.js';
import type {
  UDCSignal,
  MarketSnapshot,
  PortfolioState,
  OptionChainEntry,
} from '../src/lib/udc/types.js';
import crypto from 'crypto';

function buildChain(
  symbol: string,
  spotPrice: number,
  dte: number,
  expiry: string,
): OptionChainEntry[] {
  const entries: OptionChainEntry[] = [];
  const strikePct = 0.01;

  for (let i = -5; i <= 5; i++) {
    const strike = Math.round(spotPrice * (1 + i * strikePct) * 100) / 100;
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
        symbol: `${symbol}${expiry}${type[0]}${strike}`,
        expiry,
        dte,
        strike,
        type,
        bid: Math.round((mid * 0.95) * 100) / 100,
        ask: Math.round((mid * 1.05) * 100) / 100,
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
  const now = Date.now();
  const expiry1 = '2026-02-27';
  const expiry2 = '2026-03-06';

  return {
    symbol,
    price,
    timestamp: now,
    stale: false,
    chain: [
      ...buildChain(symbol, price, 3, expiry1),
      ...buildChain(symbol, price, 10, expiry2),
    ],
  };
}

const portfolio: PortfolioState = {
  risk: {
    drawdownPct: 2.5,
    positionCount: 1,
    dailyPnL: -150,
    maxDailyLoss: 1000,
    portfolioDelta: 0.3,
    portfolioGamma: 0.02,
    maxOpenPositions: 5,
    dteConcentration: {},
    lastEntryTimestamp: Date.now() - 3600_000,
  },
};

const TEST_SIGNALS: { name: string; signal: UDCSignal; price: number }[] = [
  // ── STRAT: Tier 1 — 2-1-2 Reversals (highest win-rate on ETFs) ───────
  {
    name: 'SPY Long 4H — Strat 2-1-2U Rev (Tier 1)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'long',
      timeframe: '15',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 502.45,
        setup: '2-1-2U Rev',
        entry: 503.20,
        stop: 498.50,
        target: 510.00,
        score: 78,
        c1_type: '1', c2_type: '2D',
        c1_high: 503.20, c1_low: 499.80,
        tf_confluence_count: 3,
        flow_sentiment: 'bullish',
      },
    },
    price: 502.45,
  },
  {
    name: 'QQQ Short D — Strat 2-1-2D Rev (Tier 1)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '60',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 430.20,
        setup: '2-1-2D Rev',
        entry: 428.50,
        stop: 434.00,
        target: 420.00,
        score: 82,
        c1_type: '1', c2_type: '2U',
        c1_high: 433.50, c1_low: 428.50,
        tf_confluence_count: 2,
        flow_sentiment: 'bearish',
      },
    },
    price: 430.20,
  },
  {
    name: 'IWM Long W — Strat 2-1-2U Rev (Tier 1, weekly)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'IWM',
      direction: 'long',
      timeframe: '60',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 220.10,
        setup: '2-1-2U Rev',
        entry: 221.00,
        stop: 215.50,
        target: 230.00,
        score: 85,
        c1_type: '1', c2_type: '2D',
        c1_high: 221.00, c1_low: 217.20,
        tf_confluence_count: 4,
        flow_sentiment: 'bullish',
      },
    },
    price: 220.10,
  },

  // ── STRAT: Tier 2 — 2-1-2 Continuations ──────────────────────────────
  {
    name: 'SPY Long 15m — Strat 2-1-2U Cont (Tier 2)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'long',
      timeframe: '15',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 503.80,
        setup: '2-1-2U Cont',
        entry: 504.20,
        stop: 501.00,
        target: 509.00,
        score: 72,
        c1_type: '1', c2_type: '2U',
        c1_high: 504.20, c1_low: 502.00,
        tf_confluence_count: 2,
      },
    },
    price: 503.80,
  },
  {
    name: 'QQQ Short 5m — Strat 2-1-2D Cont (Tier 2)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 429.00,
        setup: '2-1-2D Cont',
        entry: 428.30,
        stop: 431.50,
        target: 424.00,
        score: 68,
        c1_type: '1', c2_type: '2D',
        c1_high: 430.80, c1_low: 428.30,
      },
    },
    price: 429.00,
  },

  // ── STRAT: Tier 3 — Outside bar combos ────────────────────────────────
  {
    name: 'SPY Long D — Strat 3-1-2U Rev (Tier 3)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'long',
      timeframe: '60',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 501.00,
        setup: '3-1-2U Rev',
        entry: 502.50,
        stop: 496.00,
        target: 512.00,
        score: 70,
        c1_type: '1', c2_type: '3',
        c1_high: 502.50, c1_low: 498.00,
        tf_confluence_count: 2,
      },
    },
    price: 501.00,
  },
  {
    name: 'IWM Short 15m — Strat 3-2D-2D Cont (Tier 3)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'IWM',
      direction: 'short',
      timeframe: '15',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 219.40,
        setup: '3-2D-2D Cont',
        entry: 218.80,
        stop: 222.00,
        target: 214.00,
        score: 65,
        c1_type: '2D', c2_type: '3',
        c1_high: 220.50, c1_low: 218.80,
      },
    },
    price: 219.40,
  },

  // ── STRAT: Generic / webhook-sourced ──────────────────────────────────
  {
    name: 'QQQ Long 5m — Strat (generic pattern, price-derived stop)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'QQQ',
      direction: 'long',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'STRAT_SETUP',
      raw_payload: {
        price: 431.50,
        engine: 'STRAT_V6_FULL',
        components: ['STRAT_SETUP', 'HTF_IGNITION'],
      },
    },
    price: 431.50,
  },

  // ── SATYLAND: Markup / Markdown phases ─────────────────────────────────
  {
    name: 'SPY Long 5m — Satyland Markup (ribbon aligned)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'SATY_MARKUP',
      confidence: 0.72,
      raw_payload: {
        price: 503.10,
        meta: { engine: 'SATY_PO', source: 'tradingview_indicator' },
        event: { phase_name: 'MARKUP' },
        regime_context: { local_bias: 'BULLISH' },
        ribbonAlignment: 'bullish',
        volumeQuality: 'high',
        atLevelToLevel: true,
      },
    },
    price: 503.10,
  },
  {
    name: 'QQQ Short 15m — Satyland Markdown (strong bear)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '15',
      timestamp: Date.now(),
      pattern: 'SATY_MARKDOWN',
      confidence: 0.74,
      raw_payload: {
        price: 428.80,
        meta: { engine: 'SATY_PO' },
        event: { phase_name: 'MARKDOWN' },
        regime_context: { local_bias: 'BEARISH' },
        ribbonAlignment: 'bearish',
        volumeQuality: 'high',
      },
    },
    price: 428.80,
  },
  {
    name: 'IWM Long 60m — Satyland Accumulation (early base)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'IWM',
      direction: 'long',
      timeframe: '60',
      timestamp: Date.now(),
      pattern: 'SATYLAND_ACCUMULATION',
      raw_payload: {
        price: 218.90,
        meta: { engine: 'SATY_PO' },
        event: { phase_name: 'ACCUMULATION' },
        ribbonAlignment: 'neutral',
        volumeQuality: 'average',
        atr_support: 215.40,
      },
    },
    price: 218.90,
  },
  {
    name: 'SPY Short D — Satyland Distribution (topping)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'short',
      timeframe: '60',
      timestamp: Date.now(),
      pattern: 'SATYLAND_DISTRIBUTION',
      raw_payload: {
        price: 505.20,
        meta: { engine: 'SATY_PO' },
        event: { phase_name: 'DISTRIBUTION' },
        ribbonAlignment: 'bearish',
        volumeQuality: 'high',
        atr_resistance: 510.80,
      },
    },
    price: 505.20,
  },

  // ── SATYLAND: MTF Trend / Phase Oscillator ────────────────────────────
  {
    name: 'NVDA Long 5m — MTF Trend (Satyland variant)',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'NVDA',
      direction: 'long',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'MTF_TREND',
      confidence: 0.78,
      raw_payload: {
        price: 795.60,
        meta: { engine: 'SATYLAND' },
        phase: 'markup',
        ribbonAlignment: 'bullish',
        volumeQuality: 'high',
        atLevelToLevel: true,
      },
    },
    price: 795.60,
  },

  // ── EXISTING STRATEGIES (kept for regression) ─────────────────────────
  {
    name: 'SPY Long 5m — ORB Breakout',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'ORB',
      confidence: 0.82,
      raw_payload: { price: 502.45 },
    },
    price: 502.45,
  },
  {
    name: 'QQQ Short 15m — Failed 2-Up',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '15',
      timestamp: Date.now(),
      pattern: 'FAILED_2UP',
      confidence: 0.75,
      raw_payload: { price: 430.20 },
    },
    price: 430.20,
  },
  {
    name: 'AAPL Long 5m — Momentum',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'AAPL',
      direction: 'long',
      timeframe: '5',
      timestamp: Date.now(),
      pattern: 'MOMENTUM',
      confidence: 0.68,
      raw_payload: { price: 228.50 },
    },
    price: 228.50,
  },
  {
    name: 'SPY Short 1m — Scalp Reversal',
    signal: {
      id: crypto.randomUUID(),
      symbol: 'SPY',
      direction: 'short',
      timeframe: '1',
      timestamp: Date.now(),
      pattern: 'SCALP_REV',
      confidence: 0.60,
      raw_payload: { price: 502.45 },
    },
    price: 502.45,
  },
];

async function main() {
  await initTradingMode();
  const mode = getTradingMode();

  console.log('='.repeat(80));
  console.log('  UDC DIRECT TEST — Unified Decision Core Signal Processing');
  console.log('='.repeat(80));
  console.log(`  Trading Mode: ${mode}`);
  console.log(`  Portfolio: ${portfolio.risk.positionCount} positions, $${portfolio.risk.dailyPnL} daily P&L`);
  console.log(`  Signals: ${TEST_SIGNALS.length} test signals`);
  console.log('='.repeat(80));

  const results: { name: string; status: string; reason?: string; plan?: any; decisionId: string }[] = [];

  for (const test of TEST_SIGNALS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  SIGNAL: ${test.name}`);
    console.log(`  ${test.signal.symbol} ${test.signal.direction} ${test.signal.timeframe}m | pattern: ${test.signal.pattern} | conf: ${test.signal.confidence}`);
    console.log(`${'─'.repeat(80)}`);

    const snapshot = buildSnapshot(test.signal.symbol, test.price);
    console.log(`  Snapshot: $${test.price} | chain: ${snapshot.chain!.length} options | stale: ${snapshot.stale}`);

    try {
      const result = await runUDC(test.signal, snapshot, portfolio);

      results.push({
        name: test.name,
        status: result.status,
        reason: result.reason,
        plan: result.plan,
        decisionId: result.decisionId,
      });

      const statusIcon =
        result.status === 'PLAN_CREATED' ? '[PLAN]' :
        result.status === 'NO_STRATEGY' ? '[SKIP]' :
        '[BLOCK]';

      console.log(`\n  ${statusIcon} UDC Decision: ${result.status}`);
      console.log(`  Decision ID: ${result.decisionId}`);

      if (result.reason) {
        console.log(`  Reason: ${result.reason}`);
      }

      if (result.decision) {
        const intent = result.decision.intent;
        console.log(`  Strategy: ${intent.strategy} | Structure: ${intent.structure}`);
        console.log(`  Direction: ${intent.direction} | Confidence: ${intent.confidence}`);
        console.log(`  DTE Range: ${intent.dteMin}-${intent.dteMax} | Invalidation: ${intent.invalidation}`);
      }

      if (result.plan) {
        console.log(`\n  ORDER PLAN:`);
        console.log(`    Plan ID: ${result.plan.planId}`);
        console.log(`    Symbol: ${result.plan.symbol}`);
        console.log(`    Structure: ${result.plan.structure}`);
        console.log(`    Max Loss: $${result.plan.risk.maxLoss}`);
        console.log(`    Legs:`);
        for (const leg of result.plan.legs) {
          console.log(`      ${leg.side} ${leg.quantity}x ${leg.symbol} (${leg.type}) @ $${leg.strike} exp ${leg.expiry}`);
        }
      }

      // Persist snapshot to DB for dashboard visibility
      try {
        await db.query(
          `INSERT INTO decision_snapshots (signal_id, decision_id, status, reason, order_plan_json, strategy_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT DO NOTHING`,
          [
            test.signal.id,
            result.decisionId,
            result.status,
            result.reason ?? null,
            result.plan ? JSON.stringify(result.plan) : null,
            result.decision ? JSON.stringify(result.decision) : null,
          ],
        );
        console.log(`  [DB] Snapshot persisted`);
      } catch (dbErr: any) {
        console.log(`  [DB] Persist failed: ${dbErr.message}`);
      }
    } catch (err: any) {
      console.log(`  [ERROR] ${err.message}`);
      results.push({ name: test.name, status: 'ERROR', reason: err.message, decisionId: 'error' });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('  UDC RESULTS SUMMARY');
  console.log('='.repeat(80));

  const planCount = results.filter(r => r.status === 'PLAN_CREATED').length;
  const noStratCount = results.filter(r => r.status === 'NO_STRATEGY').length;
  const blockedCount = results.filter(r => r.status === 'BLOCKED').length;
  const errorCount = results.filter(r => r.status === 'ERROR').length;

  console.log(`  Total Signals:     ${results.length}`);
  console.log(`  PLAN_CREATED:      ${planCount}`);
  console.log(`  NO_STRATEGY:       ${noStratCount}`);
  console.log(`  BLOCKED:           ${blockedCount}`);
  console.log(`  ERROR:             ${errorCount}`);

  console.log(`\n  Detailed Results:`);
  for (const r of results) {
    const icon =
      r.status === 'PLAN_CREATED' ? '+' :
      r.status === 'NO_STRATEGY' ? '-' :
      r.status === 'BLOCKED' ? 'X' : '!';
    console.log(`    [${icon}] ${r.name}`);
    console.log(`        Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    console.log(`        Decision: ${r.decisionId}`);
  }

  console.log(`\n${'='.repeat(80)}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
