/**
 * Engine B Validator for GTM Launch Readiness
 * 
 * Validates Engine B (multi-agent decision system) including:
 * - Meta-agent orchestration
 * - Agent context provision (Context, Technical, Risk, Specialist agents)
 * - Confidence normalization (0-100 scale)
 * - Weighted voting mechanism
 * - Risk agent veto authority
 * - Disagreement flagging
 */

import { ValidationResult, ValidationCategory } from '../types/index.js';
import { MetaDecisionAgent } from '../../agents/core/meta-decision-agent.js';
import { ContextAgent } from '../../agents/core/context-agent.js';
import { TechnicalAgent } from '../../agents/core/technical-agent.js';
import { RiskAgent } from '../../agents/core/risk-agent.js';
import type { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

/**
 * Helper to create base enriched signal
 */
function createBaseSignal(): EnrichedSignal {
  return {
    signalId: 'test-signal-1',
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date(),
    sessionType: 'RTH',
  };
}

/**
 * Helper to create base market data
 */
function createBaseMarketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    candles: [],
    currentPrice: 450,
    sessionContext: {
      sessionType: 'RTH',
      isMarketOpen: true,
      minutesUntilClose: 300,
    },
    indicators: {
      ema8: [448, 449, 450],
      ema13: [447, 448, 449],
      ema21: [445, 446, 447],
      ema48: [440, 442, 444],
      ema200: [420, 422, 424],
      atr: [2.5, 2.6, 2.7],
      bollingerBands: {
        upper: [455, 456, 457],
        middle: [450, 451, 452],
        lower: [445, 446, 447],
      },
      keltnerChannels: {
        upper: [454, 455, 456],
        middle: [450, 451, 452],
        lower: [446, 447, 448],
      },
      ttmSqueeze: {
        state: 'off',
        momentum: 0.5,
      },
    },
    gex: {
      symbol: 'SPY',
      netGex: 5000000,
      totalCallGex: 8000000,
      totalPutGex: 3000000,
      zeroGammaLevel: 448,
      dealerPosition: 'long_gamma',
      volatilityExpectation: 'compressed',
      updatedAt: new Date(),
      levels: [],
    },
    risk: {
      positionLimitExceeded: false,
      exposureExceeded: false,
    },
    ...overrides,
  };
}

/**
 * Engine B Validator
 */
export class EngineBValidator {
  /**
   * Validate meta-agent orchestration
   * Requirements: 4.1
   */
  async validateMetaAgentOrchestration(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const metaAgent = new MetaDecisionAgent();
      const contextAgent = new ContextAgent();
      const technicalAgent = new TechnicalAgent();
      const riskAgent = new RiskAgent();

      // Verify all agents can be instantiated
      if (!metaAgent || !contextAgent || !technicalAgent || !riskAgent) {
        failures.push({
          testName: 'agents-instantiation',
          expectedOutcome: 'All agents should be instantiable',
          actualOutcome: 'One or more agents failed to instantiate',
          errorMessage: 'Agent instantiation failed',
          context: {},
        });
      }

      // Verify meta-agent can aggregate outputs
      const signal = createBaseSignal();
      const marketData = createBaseMarketData();

      const contextOutput = await contextAgent.analyze(signal, marketData);
      const technicalOutput = await technicalAgent.analyze(signal, marketData);
      const riskOutput = await riskAgent.analyze(signal, marketData);

      if (!contextOutput || !technicalOutput || !riskOutput) {
        failures.push({
          testName: 'agents-produce-outputs',
          expectedOutcome: 'All agents should produce outputs',
          actualOutcome: 'One or more agents failed to produce output',
          errorMessage: 'Agent analysis failed',
          context: {},
        });
      }

      // Verify meta-agent can aggregate
      const agentOutputs = [contextOutput, technicalOutput, riskOutput];
      const marketDataWithOutputs = { ...marketData, agentOutputs } as any;
      const metaOutput = await metaAgent.analyze(signal, marketDataWithOutputs);

      if (!metaOutput) {
        failures.push({
          testName: 'meta-agent-aggregation',
          expectedOutcome: 'Meta-agent should aggregate outputs',
          actualOutcome: 'Meta-agent failed to produce output',
          errorMessage: 'Meta-agent aggregation failed',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'meta-agent-orchestration-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate agent context provision
   * Requirements: 4.2, 4.3, 4.4, 4.5
   */
  async validateAgentContext(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const signal = createBaseSignal();
      
      // Test Context Agent receives market regime data
      const contextMarketData = createBaseMarketData({
        sessionContext: {
          sessionType: 'RTH',
          isMarketOpen: true,
          minutesUntilClose: 300,
        },
      });

      const contextAgent = new ContextAgent();
      const contextOutput = await contextAgent.analyze(signal, contextMarketData);

      if (!contextOutput || typeof contextOutput.confidence !== 'number') {
        failures.push({
          testName: 'context-agent-data',
          expectedOutcome: 'Context agent should receive session context',
          actualOutcome: 'Context agent failed to process data',
          errorMessage: 'Context agent data provision failed',
          context: {},
        });
      }

      // Test Technical Agent receives price action and indicators
      const technicalMarketData = createBaseMarketData();

      const technicalAgent = new TechnicalAgent();
      const technicalOutput = await technicalAgent.analyze(signal, technicalMarketData);

      if (!technicalOutput || typeof technicalOutput.confidence !== 'number') {
        failures.push({
          testName: 'technical-agent-data',
          expectedOutcome: 'Technical agent should receive indicators',
          actualOutcome: 'Technical agent failed to process data',
          errorMessage: 'Technical agent data provision failed',
          context: {},
        });
      }

      // Test Risk Agent receives position exposure
      const riskMarketData = createBaseMarketData({
        risk: {
          positionLimitExceeded: false,
          exposureExceeded: false,
        },
      });

      const riskAgent = new RiskAgent();
      const riskOutput = await riskAgent.analyze(signal, riskMarketData);

      if (!riskOutput || typeof riskOutput.block !== 'boolean') {
        failures.push({
          testName: 'risk-agent-data',
          expectedOutcome: 'Risk agent should receive risk limits',
          actualOutcome: 'Risk agent failed to process data',
          errorMessage: 'Risk agent data provision failed',
          context: {},
        });
      }

    } catch (error) {
      failures.push({
        testName: 'agent-context-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate confidence normalization
   * Requirements: 4.6
   */
  async validateConfidenceNormalization(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const signal = createBaseSignal();
      const marketData = createBaseMarketData();

      const contextAgent = new ContextAgent();
      const technicalAgent = new TechnicalAgent();
      const riskAgent = new RiskAgent();

      const contextOutput = await contextAgent.analyze(signal, marketData);
      const technicalOutput = await technicalAgent.analyze(signal, marketData);
      const riskOutput = await riskAgent.analyze(signal, marketData);

      // Verify all confidence scores are in 0-100 range
      const outputs = [contextOutput, technicalOutput, riskOutput];
      
      for (const output of outputs) {
        if (output.confidence < 0 || output.confidence > 100) {
          failures.push({
            testName: `confidence-normalization-${output.agent}`,
            expectedOutcome: 'Confidence should be in 0-100 range',
            actualOutcome: `Confidence: ${output.confidence}`,
            errorMessage: 'Confidence not normalized',
            context: { agent: output.agent, confidence: output.confidence },
          });
        }
      }

    } catch (error) {
      failures.push({
        testName: 'confidence-normalization-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate weighted voting mechanism
   * Requirements: 4.7
   */
  async validateWeightedVoting(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const metaAgent = new MetaDecisionAgent();
      
      // Create mock agent outputs with different biases and confidences
      const mockOutputs: AgentOutput[] = [
        {
          agent: 'context',
          bias: 'bullish',
          confidence: 70,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'technical',
          bias: 'bullish',
          confidence: 80,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'risk',
          bias: 'neutral',
          confidence: 50,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
      ];

      const decision = metaAgent.aggregate(mockOutputs);

      // Verify decision has required fields
      if (!decision.finalBias || typeof decision.finalConfidence !== 'number') {
        failures.push({
          testName: 'weighted-voting-output',
          expectedOutcome: 'Decision should have finalBias and finalConfidence',
          actualOutcome: `Decision: ${JSON.stringify(decision)}`,
          errorMessage: 'Weighted voting output incomplete',
          context: { decision },
        });
      }

      // Verify final confidence is calculated
      if (decision.finalConfidence < 0 || decision.finalConfidence > 100) {
        failures.push({
          testName: 'weighted-voting-confidence-range',
          expectedOutcome: 'Final confidence should be in 0-100 range',
          actualOutcome: `Confidence: ${decision.finalConfidence}`,
          errorMessage: 'Final confidence out of range',
          context: { decision },
        });
      }

      // Verify consensus strength is calculated
      if (typeof decision.consensusStrength !== 'number') {
        failures.push({
          testName: 'weighted-voting-consensus',
          expectedOutcome: 'Decision should have consensus strength',
          actualOutcome: `Consensus: ${decision.consensusStrength}`,
          errorMessage: 'Consensus strength not calculated',
          context: { decision },
        });
      }

    } catch (error) {
      failures.push({
        testName: 'weighted-voting-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 3 : Math.max(0, 3 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate Risk Agent veto authority
   * Requirements: 4.8
   */
  async validateRiskAgentVeto(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const metaAgent = new MetaDecisionAgent();
      
      // Create scenario where Risk Agent blocks
      const mockOutputsWithVeto: AgentOutput[] = [
        {
          agent: 'context',
          bias: 'bullish',
          confidence: 90,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'technical',
          bias: 'bullish',
          confidence: 95,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'risk',
          bias: 'neutral',
          confidence: 0,
          reasons: ['position_limit_exceeded'],
          block: true, // Risk agent veto!
          metadata: { agentType: 'core' },
        },
      ];

      const decision = metaAgent.aggregate(mockOutputsWithVeto);

      // Verify decision is rejected despite high confidence from other agents
      if (decision.decision !== 'reject') {
        failures.push({
          testName: 'risk-agent-veto-authority',
          expectedOutcome: 'Risk agent veto should reject decision',
          actualOutcome: `Decision: ${decision.decision}`,
          errorMessage: 'Risk agent veto not enforced',
          context: { decision },
        });
      }

      // Verify final confidence is 0 when vetoed
      if (decision.finalConfidence !== 0) {
        failures.push({
          testName: 'risk-agent-veto-confidence',
          expectedOutcome: 'Vetoed decision should have 0 confidence',
          actualOutcome: `Confidence: ${decision.finalConfidence}`,
          errorMessage: 'Veto confidence not set to 0',
          context: { decision },
        });
      }

    } catch (error) {
      failures.push({
        testName: 'risk-agent-veto-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 2 : Math.max(0, 2 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate disagreement flagging
   * Requirements: 4.9
   */
  async validateDisagreementFlagging(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const metaAgent = new MetaDecisionAgent();
      
      // Create scenario with significant disagreement
      const mockOutputsWithDisagreement: AgentOutput[] = [
        {
          agent: 'context',
          bias: 'bullish',
          confidence: 90,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'technical',
          bias: 'bearish',
          confidence: 85,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
        {
          agent: 'risk',
          bias: 'neutral',
          confidence: 50,
          reasons: ['test'],
          block: false,
          metadata: { agentType: 'core' },
        },
      ];

      const decision = metaAgent.aggregate(mockOutputsWithDisagreement);

      // Verify consensus strength is low when agents disagree
      if (decision.consensusStrength > 70) {
        failures.push({
          testName: 'disagreement-consensus-low',
          expectedOutcome: 'Disagreement should result in low consensus',
          actualOutcome: `Consensus: ${decision.consensusStrength}`,
          errorMessage: 'Disagreement not reflected in consensus',
          context: { decision },
        });
      }

      // Verify decision structure includes contributing agents
      if (!decision.contributingAgents || decision.contributingAgents.length === 0) {
        failures.push({
          testName: 'disagreement-contributing-agents',
          expectedOutcome: 'Decision should list contributing agents',
          actualOutcome: 'No contributing agents listed',
          errorMessage: 'Contributing agents not tracked',
          context: { decision },
        });
      }

    } catch (error) {
      failures.push({
        testName: 'disagreement-flagging-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 2 : Math.max(0, 2 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }

  /**
   * Validate GEX (Gamma Exposure) logic in Engine B
   * Validates that GEX data is properly used by agents for decision making
   */
  async validateGEXLogic(): Promise<ValidationResult> {
    const startTime = Date.now();
    const failures = [];

    try {
      const signal = createBaseSignal();
      
      // Test 1: Positive GEX (long gamma regime) - should favor mean reversion
      const positiveGexData = createBaseMarketData({
        gex: {
          symbol: 'SPY',
          netGex: 5000000, // Positive = long gamma
          totalCallGex: 8000000,
          totalPutGex: 3000000,
          zeroGammaLevel: 448,
          dealerPosition: 'long_gamma',
          volatilityExpectation: 'compressed',
          updatedAt: new Date(),
          levels: [],
        },
      });

      const contextAgent = new ContextAgent();
      const contextOutput = await contextAgent.analyze(signal, positiveGexData);

      if (!contextOutput) {
        failures.push({
          testName: 'gex-positive-context-analysis',
          expectedOutcome: 'Context agent should analyze with positive GEX',
          actualOutcome: 'No output produced',
          errorMessage: 'Context agent failed with positive GEX',
          context: { gex: positiveGexData.gex },
        });
      }

      // Test 2: Negative GEX (short gamma regime) - should expect higher volatility
      const negativeGexData = createBaseMarketData({
        gex: {
          symbol: 'SPY',
          netGex: -5000000, // Negative = short gamma
          totalCallGex: 3000000,
          totalPutGex: 8000000,
          zeroGammaLevel: 452,
          dealerPosition: 'short_gamma',
          volatilityExpectation: 'expanding',
          updatedAt: new Date(),
          levels: [],
        },
      });

      const contextOutputNegGex = await contextAgent.analyze(signal, negativeGexData);

      if (!contextOutputNegGex) {
        failures.push({
          testName: 'gex-negative-context-analysis',
          expectedOutcome: 'Context agent should analyze with negative GEX',
          actualOutcome: 'No output produced',
          errorMessage: 'Context agent failed with negative GEX',
          context: { gex: negativeGexData.gex },
        });
      }

      // Test 3: GEX data should be available to specialist agents
      const gammaFlowSpecialist = await import('../../agents/specialists/gamma-flow-specialist.js');
      const specialist = new gammaFlowSpecialist.GammaFlowSpecialist();

      const specialistOutput = await specialist.analyze(signal, positiveGexData);

      if (!specialistOutput) {
        failures.push({
          testName: 'gex-specialist-activation',
          expectedOutcome: 'Gamma Flow specialist should activate with GEX data',
          actualOutcome: 'No output produced',
          errorMessage: 'Specialist failed to activate',
          context: { gex: positiveGexData.gex },
        });
      }

      // Verify specialist output includes GEX metadata
      if (specialistOutput && (!specialistOutput.metadata || !('gex' in specialistOutput.metadata))) {
        failures.push({
          testName: 'gex-specialist-metadata',
          expectedOutcome: 'Specialist output should include GEX metadata',
          actualOutcome: 'GEX metadata missing',
          errorMessage: 'GEX data not included in specialist metadata',
          context: { output: specialistOutput },
        });
      }

      // Test 4: Zero Gamma Level should be tracked
      if (positiveGexData.gex && positiveGexData.gex.zeroGammaLevel) {
        const zeroGammaLevel = positiveGexData.gex.zeroGammaLevel;
        const currentPrice = positiveGexData.currentPrice;

        // Verify zero gamma level is reasonable relative to current price
        const priceDistance = Math.abs(currentPrice - zeroGammaLevel);
        const percentDistance = (priceDistance / currentPrice) * 100;

        if (percentDistance > 10) {
          failures.push({
            testName: 'gex-zero-gamma-level-reasonable',
            expectedOutcome: 'Zero gamma level should be within 10% of current price',
            actualOutcome: `Distance: ${percentDistance.toFixed(2)}%`,
            errorMessage: 'Zero gamma level unreasonably far from current price',
            context: { zeroGammaLevel, currentPrice, percentDistance },
          });
        }
      }

      // Test 5: Dealer position should influence decision
      const longGammaOutput = await specialist.analyze(signal, positiveGexData);
      const shortGammaOutput = await specialist.analyze(signal, negativeGexData);

      if (longGammaOutput && shortGammaOutput) {
        // Long gamma should generally have different confidence than short gamma
        // (though not strictly required, it's a good indicator the logic is working)
        const confidenceDiff = Math.abs(longGammaOutput.confidence - shortGammaOutput.confidence);
        
        if (confidenceDiff === 0 && longGammaOutput.bias === shortGammaOutput.bias) {
          failures.push({
            testName: 'gex-regime-influence',
            expectedOutcome: 'Different GEX regimes should influence decisions',
            actualOutcome: 'Identical outputs for different GEX regimes',
            errorMessage: 'GEX regime not influencing specialist decisions',
            context: { 
              longGammaOutput: { confidence: longGammaOutput.confidence, bias: longGammaOutput.bias },
              shortGammaOutput: { confidence: shortGammaOutput.confidence, bias: shortGammaOutput.bias },
            },
          });
        }
      }

      // Test 6: Missing GEX data should be handled gracefully
      const noGexData = createBaseMarketData({
        gex: undefined,
      });

      const outputNoGex = await specialist.analyze(signal, noGexData);

      if (!outputNoGex) {
        failures.push({
          testName: 'gex-missing-data-handling',
          expectedOutcome: 'Specialist should handle missing GEX data gracefully',
          actualOutcome: 'Failed to produce output',
          errorMessage: 'Specialist crashed with missing GEX data',
          context: {},
        });
      }

      // Verify output indicates GEX unavailability
      if (outputNoGex && !outputNoGex.reasons.some(r => r.toLowerCase().includes('gex') && r.toLowerCase().includes('unavailable'))) {
        failures.push({
          testName: 'gex-missing-data-indication',
          expectedOutcome: 'Output should indicate GEX data unavailable',
          actualOutcome: 'No indication of missing GEX data',
          errorMessage: 'Missing GEX not communicated in output',
          context: { reasons: outputNoGex.reasons },
        });
      }

    } catch (error) {
      failures.push({
        testName: 'gex-logic-validation',
        expectedOutcome: 'Validation should complete',
        actualOutcome: 'Failed with error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        context: {},
      });
    }

    return {
      category: ValidationCategory.ENGINE_B,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      testsPassed: failures.length === 0 ? 6 : Math.max(0, 6 - failures.length),
      testsFailed: failures.length,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures,
    };
  }
}
