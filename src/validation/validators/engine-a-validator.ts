/**
 * Engine A Validator for GTM Launch Readiness
 * 
 * Validates Engine A (rule-based decision engine) including tier evaluation order,
 * hard blocks, delay queueing, and exit logic.
 */

import { ValidationResult, ValidationCategory } from '../types/index.js';
import { evaluateEntryDecision } from '../../lib/entryEngine/evaluator.js';
import { evaluateExitDecision } from '../../lib/exitEngine/evaluator.js';
import type { EntryDecisionInput } from '../../lib/entryEngine/types.js';
import type { ExitDecisionInput } from '../../lib/exitEngine/types.js';

/**
 * Helper to create a base entry input
 */
function createBaseEntryInput(overrides: Partial<EntryDecisionInput> = {}): EntryDecisionInput {
  return {
    symbol: 'SPY',
    timestamp: Date.now(),
    direction: 'CALL',
    setupType: 'SWING',
    signal: {
      confidence: 75,
      pattern: 'ORB',
      timeframe: '5m',
    },
    marketContext: {
      price: 450,
      regime: 'NEUTRAL',
      gexState: 'NEUTRAL',
      volatility: 15,
      ivPercentile: 50,
    },
    timingContext: {
      session: 'MORNING',
      minutesFromOpen: 60,
      liquidityState: 'NORMAL',
    },
    riskContext: {
      dailyPnL: 0,
      openTradesCount: 0,
      portfolioDelta: 0,
      portfolioTheta: 0,
    },
    ...overrides,
  };
}

/**
 * Helper to create a base exit input
 */
function createBaseExitInput(overrides: Partial<ExitDecisionInput> = {}): ExitDecisionInput {
  return {
    tradePosition: {
      id: 'test-1',
      symbol: 'SPY',
      direction: 'CALL',
      setupType: 'SWING',
    },
    entryData: {
      timestamp: Date.now() - 3600000,
      underlyingEntryPrice: 450,
      optionEntryPrice: 5.0,
      contracts: 1,
    },
    contractDetails: {
      expiry: '2024-12-31',
      dteAtEntry: 30,
      strike: 455,
      greeksAtEntry: {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.05,
        vega: 0.2,
      },
      ivAtEntry: 20,
    },
    guardrails: {
      maxHoldTime: 1440,
      timeStops: [],
      progressChecks: [],
      thetaBurnLimit: 50,
      invalidationLevels: {
        stopLoss: -30,
        thesisInvalidation: -20,
      },
    },
    targets: {
      partialTakeProfitPercent: [25, 50],
      fullTakeProfitPercent: 100,
      stopLossPercent: 30,
    },
    liveMarket: {
      timestamp: Date.now(),
      underlyingPrice: 450,
      optionBid: 5.0,
      optionAsk: 5.2,
      optionMid: 5.1,
      currentGreeks: {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.05,
        vega: 0.2,
      },
      currentIV: 20,
      currentDTE: 30,
      spreadPercent: 2,
      regime: 'NEUTRAL',
      gexState: 'NEUTRAL',
    },
    ...overrides,
  };
}

/**
 * Engine A Validator
 */
export class EngineAValidator {
  /**
   * Validate tier evaluation order for entry decisions
   * Requirements: 3.1, 3.3, 3.5
   */
  async validateTierEvaluationOrder(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      // Test Tier 1 blocks
      const tier1Input = createBaseEntryInput({
        signal: { confidence: 30, pattern: 'ORB', timeframe: '5m' },
      });
      const tier1Result = evaluateEntryDecision(tier1Input);

      if (tier1Result.action !== 'BLOCK') {
        failures.push({
          testName: 'tier1-blocks-evaluation',
          expectedOutcome: 'Tier 1 violation should result in BLOCK',
          actualOutcome: `Action: ${tier1Result.action}`,
          errorMessage: 'Tier 1 did not block',
          context: { output: tier1Result },
        });
      }

      // Test Tier 2 delays
      const tier2Input = createBaseEntryInput({
        signal: { confidence: 75, pattern: 'ORB', timeframe: '5m', confirmationPending: true },
      });
      const tier2Result = evaluateEntryDecision(tier2Input);

      if (tier2Result.action !== 'WAIT') {
        failures.push({
          testName: 'tier2-delays-evaluation',
          expectedOutcome: 'Tier 2 delay should result in WAIT',
          actualOutcome: `Action: ${tier2Result.action}`,
          errorMessage: 'Tier 2 did not delay',
          context: { output: tier2Result },
        });
      }

      // Test Tier 3 entry
      const tier3Input = createBaseEntryInput();
      const tier3Result = evaluateEntryDecision(tier3Input);

      if (tier3Result.action !== 'ENTER') {
        failures.push({
          testName: 'tier3-entry-reached',
          expectedOutcome: 'Tier 3 should result in ENTER',
          actualOutcome: `Action: ${tier3Result.action}`,
          errorMessage: 'Tier 3 entry not reached',
          context: { output: tier3Result },
        });
      }

    } catch (error) {
      failures.push({
        testName: 'tier-evaluation-order-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate Tier 1 hard block rejection
   * Requirements: 3.2
   */
  async validateTier1Rejection(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      // Test low confidence
      const lowConfInput = createBaseEntryInput({
        signal: { confidence: 30, pattern: 'ORB', timeframe: '5m' },
      });
      const lowConfResult = evaluateEntryDecision(lowConfInput);

      if (lowConfResult.action !== 'BLOCK') {
        failures.push({
          testName: 'tier1-low-confidence-block',
          expectedOutcome: 'Low confidence should be blocked',
          actualOutcome: `Action: ${lowConfResult.action}`,
          errorMessage: 'Low confidence not blocked',
          context: {},
        });
      }

      // Test regime conflict
      const regimeInput = createBaseEntryInput({
        direction: 'CALL',
        marketContext: {
          price: 450,
          regime: 'STRONG_BEAR',
          gexState: 'NEUTRAL',
          volatility: 15,
          ivPercentile: 50,
        },
      });
      const regimeResult = evaluateEntryDecision(regimeInput);

      if (regimeResult.action !== 'BLOCK') {
        failures.push({
          testName: 'tier1-regime-conflict-block',
          expectedOutcome: 'Regime conflict should be blocked',
          actualOutcome: `Action: ${regimeResult.action}`,
          errorMessage: 'Regime conflict not blocked',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'tier1-rejection-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 2 : Math.max(0, 2 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate Tier 2 delay queueing
   * Requirements: 3.4
   */
  async validateTier2Queueing(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const input = createBaseEntryInput({
        signal: { confidence: 75, pattern: 'ORB', timeframe: '5m', confirmationPending: true },
      });
      const result = evaluateEntryDecision(input);

      if (result.action !== 'WAIT') {
        failures.push({
          testName: 'tier2-confirmation-pending-wait',
          expectedOutcome: 'Confirmation pending should result in WAIT',
          actualOutcome: `Action: ${result.action}`,
          errorMessage: 'Not delayed',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'tier2-queueing-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 1 : 0,
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate exit tier ordering
   * Requirements: 3.6
   */
  async validateExitTiers(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      // Test Tier 1 exit (stop loss)
      const exitInput = createBaseExitInput({
        liveMarket: {
          timestamp: Date.now(),
          underlyingPrice: 445,
          optionBid: 3.0,
          optionAsk: 3.2,
          optionMid: 3.1, // Down 38% - below stop loss
          currentGreeks: { delta: 0.4, gamma: 0.04, theta: -0.06, vega: 0.18 },
          currentIV: 22,
          currentDTE: 29,
          spreadPercent: 3,
          regime: 'NEUTRAL',
          gexState: 'NEUTRAL',
        },
      });
      const exitResult = evaluateExitDecision(exitInput);

      if (exitResult.action !== 'FULL_EXIT') {
        failures.push({
          testName: 'exit-tier1-full-exit',
          expectedOutcome: 'Tier 1 violation should result in FULL_EXIT',
          actualOutcome: `Action: ${exitResult.action}`,
          errorMessage: 'Tier 1 exit not triggered',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'exit-tiers-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 1 : 0,
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate exit recommendation completeness
   * Requirements: 3.7
   */
  async validateExitRecommendation(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const exitInput = createBaseExitInput();
      const exitResult = evaluateExitDecision(exitInput);

      const requiredFields = ['action', 'urgency', 'triggeredRules', 'rationale', 'metrics', 'timestamp'];
      
      for (const field of requiredFields) {
        if (!(field in exitResult)) {
          failures.push({
            testName: `exit-recommendation-${field}`,
            expectedOutcome: `Exit should have ${field}`,
            actualOutcome: `Field ${field} missing`,
            errorMessage: `Required field ${field} not present`,
            context: {},
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'exit-recommendation-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 6 : Math.max(0, 6 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate no-action recommendation
   * Requirements: 3.8
   */
  async validateNoActionRecommendation(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const holdInput = createBaseExitInput({
        liveMarket: {
          timestamp: Date.now(),
          underlyingPrice: 451,
          optionBid: 5.2,
          optionAsk: 5.4,
          optionMid: 5.3, // Up 6% - not at profit target
          currentGreeks: { delta: 0.52, gamma: 0.05, theta: -0.05, vega: 0.2 },
          currentIV: 20,
          currentDTE: 30,
          spreadPercent: 2,
          regime: 'NEUTRAL',
          gexState: 'NEUTRAL',
        },
      });
      const holdResult = evaluateExitDecision(holdInput);

      if (holdResult.action !== 'HOLD') {
        failures.push({
          testName: 'no-action-hold',
          expectedOutcome: 'No exit conditions should result in HOLD',
          actualOutcome: `Action: ${holdResult.action}`,
          errorMessage: 'HOLD not returned',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'no-action-recommendation-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_A,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 1 : 0,
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }
}
