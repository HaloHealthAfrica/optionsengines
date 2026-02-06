/**
 * Strike Selection Validator for GTM Launch Readiness
 * 
 * Validates strike selection system including:
 * - DTE filtering (min/max ranges by setup type)
 * - Greeks filtering (delta ranges, theta survivability)
 * - Liquidity filtering (spread, open interest, volume)
 * - Strike scoring (6 dimensions with weighted calculation)
 * - Strike ranking (highest score wins, tie-breaking)
 * - Greeks validation (delta, gamma, theta, vega in valid ranges)
 * - Output formatting (complete trade contract with guardrails)
 */

import { ValidationResult, ValidationCategory } from '../types/index.js';
import { selectStrike } from '../../lib/strikeSelection/index.js';
import type { StrikeSelectionInput, OptionContract } from '../../lib/strikeSelection/types.js';
import { DTE_POLICY, LIQUIDITY_GATES, DELTA_RANGES } from '../../lib/shared/constants.js';

/**
 * Helper to create mock option contract
 */
function createMockContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    expiry: '2026-03-20',
    dte: 45,
    strike: 450,
    bid: 4.8,
    ask: 5.2,
    mid: 5.0,
    openInterest: 5000,
    volume: 1000,
    greeks: {
      delta: 0.35,
      gamma: 0.015,
      theta: -0.08,
      vega: 0.12,
    },
    iv: 0.25,
    ...overrides,
  };
}

/**
 * Helper to create base strike selection input
 */
function createBaseInput(overrides: Partial<StrikeSelectionInput> = {}): StrikeSelectionInput {
  return {
    symbol: 'SPY',
    spotPrice: 450,
    direction: 'CALL',
    setupType: 'SWING',
    signalConfidence: 75,
    expectedHoldTime: 7 * 24 * 60, // 7 days in minutes
    expectedMovePercent: 3,
    regime: 'BULL',
    gexState: 'NEUTRAL',
    ivPercentile: 50,
    eventRisk: [],
    riskBudget: {
      maxPremiumLoss: 500,
      maxCapitalAllocation: 5000,
    },
    optionChain: [],
    ...overrides,
  };
}

/**
 * Strike Selection Validator
 */
export class StrikeSelectionValidator {
  /**
   * Validate DTE, Greeks, and Liquidity filtering
   * Requirements: 5.1, 5.2, 5.3
   */
  async validateStrikeFiltering(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      // Test DTE filtering
      const dteInput = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract({ dte: 10 }), // Too short (min 21)
          createMockContract({ dte: 45 }), // Valid
          createMockContract({ dte: 60 }), // Valid
          createMockContract({ dte: 100 }), // Too long (max 90)
        ],
      });

      const dteResult = selectStrike(dteInput);
      
      if (dteResult.success && dteResult.tradeContract) {
        const selectedDte = dteResult.tradeContract.dte;
        const policy = DTE_POLICY.SWING;
        
        if (selectedDte < policy.min || selectedDte > policy.max) {
          failures.push({
            testName: 'dte-filtering',
            expectedOutcome: `DTE should be between ${policy.min} and ${policy.max}`,
            actualOutcome: `Selected DTE: ${selectedDte}`,
            errorMessage: 'DTE filtering failed',
            context: { selectedDte, policy },
          });
        }
      }

      // Test Greeks filtering (delta range)
      const greeksInput = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract({ greeks: { delta: 0.15, gamma: 0.01, theta: -0.05, vega: 0.1 } }), // Delta too low
          createMockContract({ greeks: { delta: 0.30, gamma: 0.015, theta: -0.08, vega: 0.12 } }), // Valid
          createMockContract({ greeks: { delta: 0.50, gamma: 0.02, theta: -0.10, vega: 0.15 } }), // Delta too high
        ],
      });

      const greeksResult = selectStrike(greeksInput);
      
      if (greeksResult.success && greeksResult.tradeContract) {
        const selectedDelta = Math.abs(greeksResult.tradeContract.greeksSnapshot.delta);
        const deltaRange = DELTA_RANGES.SWING;
        
        if (selectedDelta < deltaRange.min || selectedDelta > deltaRange.max) {
          failures.push({
            testName: 'greeks-filtering',
            expectedOutcome: `Delta should be between ${deltaRange.min} and ${deltaRange.max}`,
            actualOutcome: `Selected delta: ${selectedDelta}`,
            errorMessage: 'Greeks filtering failed',
            context: { selectedDelta, deltaRange },
          });
        }
      }

      // Test Liquidity filtering
      const liquidityInput = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract({ bid: 4.0, ask: 5.0, openInterest: 100, volume: 10 }), // Low liquidity
          createMockContract({ bid: 4.8, ask: 5.2, openInterest: 5000, volume: 1000 }), // High liquidity
          createMockContract({ bid: 3.0, ask: 6.0, openInterest: 200, volume: 50 }), // Wide spread
        ],
      });

      const liquidityResult = selectStrike(liquidityInput);
      
      if (liquidityResult.success && liquidityResult.tradeContract) {
        const gates = LIQUIDITY_GATES.SWING;
        const selectedContract = liquidityInput.optionChain.find(
          c => c.strike === liquidityResult.tradeContract!.strike
        );
        
        if (selectedContract) {
          const spread = ((selectedContract.ask - selectedContract.bid) / selectedContract.mid) * 100;
          
          if (spread > gates.maxSpreadPercent || 
              selectedContract.openInterest < gates.minOpenInterest ||
              selectedContract.volume < gates.minVolume) {
            failures.push({
              testName: 'liquidity-filtering',
              expectedOutcome: 'Selected contract should meet liquidity gates',
              actualOutcome: `Spread: ${spread}%, OI: ${selectedContract.openInterest}, Vol: ${selectedContract.volume}`,
              errorMessage: 'Liquidity filtering failed',
              context: { spread, gates, selectedContract },
            });
          }
        }
      }

    } catch (error) {
      failures.push({
        testName: 'strike-filtering-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.STRIKE_SELECTION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate strike scoring completeness
   * Requirements: 5.4
   */
  async validateStrikeScoring(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const input = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract({ strike: 445 }),
          createMockContract({ strike: 450 }),
          createMockContract({ strike: 455 }),
        ],
      });

      const result = selectStrike(input);

      if (!result.success || !result.scores) {
        failures.push({
          testName: 'scoring-completeness',
          expectedOutcome: 'Result should include scores',
          actualOutcome: 'Scores missing',
          errorMessage: 'Strike scoring incomplete',
          context: { result },
        });
      } else {
        // Verify all 6 scoring dimensions are present
        const requiredDimensions = [
          'liquidityFitness',
          'greeksStability',
          'thetaSurvivability',
          'vegaIVAlignment',
          'costEfficiency',
          'gexSuitability',
        ];

        for (const dimension of requiredDimensions) {
          if (!(dimension in result.scores.breakdown)) {
            failures.push({
              testName: `scoring-dimension-${dimension}`,
              expectedOutcome: `Score should include ${dimension}`,
              actualOutcome: 'Dimension missing',
              errorMessage: 'Scoring dimension missing',
              context: { dimension, breakdown: result.scores.breakdown },
            });
          }
        }

        // Verify overall score is calculated
        if (typeof result.scores.overall !== 'number' || 
            result.scores.overall < 0 || 
            result.scores.overall > 100) {
          failures.push({
            testName: 'scoring-overall-range',
            expectedOutcome: 'Overall score should be 0-100',
            actualOutcome: `Overall: ${result.scores.overall}`,
            errorMessage: 'Overall score out of range',
            context: { overall: result.scores.overall },
          });
        }

        // Verify weights are present
        if (!result.scores.weights) {
          failures.push({
            testName: 'scoring-weights',
            expectedOutcome: 'Scores should include weights',
            actualOutcome: 'Weights missing',
            errorMessage: 'Scoring weights missing',
            context: { scores: result.scores },
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'strike-scoring-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.STRIKE_SELECTION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 4 : Math.max(0, 4 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate strike ranking order
   * Requirements: 5.5
   */
  async validateStrikeRanking(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      // Create contracts with different quality levels
      const input = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          // Low quality: poor liquidity
          createMockContract({ 
            strike: 445, 
            bid: 3.0, 
            ask: 6.0, 
            openInterest: 300, 
            volume: 100 
          }),
          // High quality: good liquidity, good Greeks
          createMockContract({ 
            strike: 450, 
            bid: 4.8, 
            ask: 5.2, 
            openInterest: 10000, 
            volume: 5000,
            greeks: { delta: 0.32, gamma: 0.015, theta: -0.08, vega: 0.12 }
          }),
          // Medium quality: decent liquidity
          createMockContract({ 
            strike: 455, 
            bid: 4.5, 
            ask: 5.5, 
            openInterest: 2000, 
            volume: 500 
          }),
        ],
      });

      const result = selectStrike(input);

      if (!result.success || !result.tradeContract) {
        failures.push({
          testName: 'ranking-selection',
          expectedOutcome: 'Should select a contract',
          actualOutcome: 'No contract selected',
          errorMessage: 'Strike ranking failed',
          context: { result },
        });
      } else {
        // Verify the highest quality contract (strike 450) was selected
        if (result.tradeContract.strike !== 450) {
          failures.push({
            testName: 'ranking-order',
            expectedOutcome: 'Should select highest scoring contract (strike 450)',
            actualOutcome: `Selected strike: ${result.tradeContract.strike}`,
            errorMessage: 'Ranking order incorrect',
            context: { 
              selectedStrike: result.tradeContract.strike,
              scores: result.scores 
            },
          });
        }

        // Verify score is highest
        if (result.scores && result.scores.overall < 50) {
          failures.push({
            testName: 'ranking-score-quality',
            expectedOutcome: 'Selected contract should have high score',
            actualOutcome: `Score: ${result.scores.overall}`,
            errorMessage: 'Selected contract has low score',
            context: { overall: result.scores.overall },
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'strike-ranking-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.STRIKE_SELECTION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 2 : Math.max(0, 2 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate Greeks calculation and validation
   * Requirements: 5.6
   */
  async validateGreeksCalculation(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const input = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract({
            greeks: { delta: 0.32, gamma: 0.015, theta: -0.08, vega: 0.12 }
          }),
        ],
      });

      const result = selectStrike(input);

      if (!result.success || !result.tradeContract) {
        failures.push({
          testName: 'greeks-presence',
          expectedOutcome: 'Result should include Greeks snapshot',
          actualOutcome: 'Greeks missing',
          errorMessage: 'Greeks not included',
          context: { result },
        });
      } else {
        const greeks = result.tradeContract.greeksSnapshot;

        // Verify all Greeks are present
        if (typeof greeks.delta !== 'number' ||
            typeof greeks.gamma !== 'number' ||
            typeof greeks.theta !== 'number' ||
            typeof greeks.vega !== 'number') {
          failures.push({
            testName: 'greeks-completeness',
            expectedOutcome: 'All Greeks should be present',
            actualOutcome: `Greeks: ${JSON.stringify(greeks)}`,
            errorMessage: 'Greeks incomplete',
            context: { greeks },
          });
        }

        // Verify Greeks are in reasonable ranges
        if (Math.abs(greeks.delta) > 1) {
          failures.push({
            testName: 'greeks-delta-range',
            expectedOutcome: 'Delta should be between -1 and 1',
            actualOutcome: `Delta: ${greeks.delta}`,
            errorMessage: 'Delta out of range',
            context: { delta: greeks.delta },
          });
        }

        if (greeks.gamma < 0 || greeks.gamma > 1) {
          failures.push({
            testName: 'greeks-gamma-range',
            expectedOutcome: 'Gamma should be between 0 and 1',
            actualOutcome: `Gamma: ${greeks.gamma}`,
            errorMessage: 'Gamma out of range',
            context: { gamma: greeks.gamma },
          });
        }

        if (greeks.theta > 0) {
          failures.push({
            testName: 'greeks-theta-sign',
            expectedOutcome: 'Theta should be negative (time decay)',
            actualOutcome: `Theta: ${greeks.theta}`,
            errorMessage: 'Theta has wrong sign',
            context: { theta: greeks.theta },
          });
        }

        if (greeks.vega < 0) {
          failures.push({
            testName: 'greeks-vega-sign',
            expectedOutcome: 'Vega should be positive',
            actualOutcome: `Vega: ${greeks.vega}`,
            errorMessage: 'Vega has wrong sign',
            context: { vega: greeks.vega },
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'greeks-calculation-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.STRIKE_SELECTION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 5 : Math.max(0, 5 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate output format consistency
   * Requirements: 5.7
   */
  async validateOutputFormatting(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const input = createBaseInput({
        setupType: 'SWING',
        optionChain: [
          createMockContract(),
        ],
      });

      const result = selectStrike(input);

      if (!result.success) {
        failures.push({
          testName: 'output-success-flag',
          expectedOutcome: 'Result should have success flag',
          actualOutcome: `Success: ${result.success}`,
          errorMessage: 'Success flag missing or false',
          context: { result },
        });
      }

      if (result.success && result.tradeContract) {
        // Verify all required fields are present
        const requiredFields = [
          'symbol', 'direction', 'setupType', 'expiry', 
          'dte', 'strike', 'midPrice', 'greeksSnapshot'
        ];

        for (const field of requiredFields) {
          if (!(field in result.tradeContract)) {
            failures.push({
              testName: `output-field-${field}`,
              expectedOutcome: `Trade contract should include ${field}`,
              actualOutcome: 'Field missing',
              errorMessage: 'Output field missing',
              context: { field, tradeContract: result.tradeContract },
            });
          }
        }

        // Verify guardrails are present
        if (!result.guardrails) {
          failures.push({
            testName: 'output-guardrails',
            expectedOutcome: 'Result should include guardrails',
            actualOutcome: 'Guardrails missing',
            errorMessage: 'Guardrails not included',
            context: { result },
          });
        } else {
          // Verify guardrails structure
          const requiredGuardrailFields = [
            'maxHoldTime', 'timeStops', 'progressChecks', 
            'thetaBurnLimit', 'invalidationLevels'
          ];

          for (const field of requiredGuardrailFields) {
            if (!(field in result.guardrails)) {
              failures.push({
                testName: `output-guardrail-${field}`,
                expectedOutcome: `Guardrails should include ${field}`,
                actualOutcome: 'Field missing',
                errorMessage: 'Guardrail field missing',
                context: { field, guardrails: result.guardrails },
              });
            }
          }
        }

        // Verify rationale is present
        if (!result.rationale || result.rationale.length === 0) {
          failures.push({
            testName: 'output-rationale',
            expectedOutcome: 'Result should include rationale',
            actualOutcome: 'Rationale missing or empty',
            errorMessage: 'Rationale not included',
            context: { result },
          });
        }
      }

      // Test failure case formatting
      const failureInput = createBaseInput({
        setupType: 'SWING',
        optionChain: [], // Empty chain should fail
      });

      const failureResult = selectStrike(failureInput);

      if (failureResult.success) {
        failures.push({
          testName: 'output-failure-case',
          expectedOutcome: 'Empty chain should result in failure',
          actualOutcome: 'Success flag is true',
          errorMessage: 'Failure case not handled',
          context: { failureResult },
        });
      } else {
        if (!failureResult.failureReason) {
          failures.push({
            testName: 'output-failure-reason',
            expectedOutcome: 'Failure should include reason',
            actualOutcome: 'Failure reason missing',
            errorMessage: 'Failure reason not provided',
            context: { failureResult },
          });
        }

        if (!failureResult.failedChecks || failureResult.failedChecks.length === 0) {
          failures.push({
            testName: 'output-failed-checks',
            expectedOutcome: 'Failure should include failed checks',
            actualOutcome: 'Failed checks missing or empty',
            errorMessage: 'Failed checks not provided',
            context: { failureResult },
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'output-formatting-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.STRIKE_SELECTION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 8 : Math.max(0, 8 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }
}
