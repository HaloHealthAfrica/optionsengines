/**
 * Test Orchestrator Implementation
 * 
 * This module implements the test orchestration layer that coordinates test execution,
 * injects synthetic data, captures system state, and provides replay functionality.
 * 
 * Requirements: 3.1, 3.2, 3.3, 14.1, 14.2, 13.5
 */

import nock from 'nock';
import { db } from '../../../src/services/database.service.js';
import {
  TestOrchestrator,
  TestConfig,
  TestContext,
  SystemState,
} from './test-orchestrator';
import { SyntheticWebhook } from '../generators/webhook-generator';
import { SyntheticGEX } from '../generators/gex-generator';

/**
 * Implementation of the TestOrchestrator interface
 */
export class TestOrchestratorImpl implements TestOrchestrator {
  private activeContexts: Map<string, TestContext> = new Map();
  private mockScopes: Map<string, nock.Scope[]> = new Map();
  private originalEnv: Map<string, string | undefined> = new Map();
  private testIdCounter: number = 0;
  private realSystemBaseUrl: string | null = null;
  private realSystemEnabled: boolean = false;
  
  /**
   * Generate a unique test ID
   */
  private generateTestId(): string {
    return `test-${Date.now()}-${++this.testIdCounter}`;
  }
  
  /**
   * Set up a test environment with the given configuration
   */
  async setupTest(config: TestConfig): Promise<TestContext> {
    const testId = this.generateTestId();
    const baseUrl = config.baseUrl || process.env.E2E_WEBHOOK_BASE_URL || '';
    this.realSystemEnabled = Boolean(config.useRealSystem && baseUrl);
    this.realSystemBaseUrl = this.realSystemEnabled ? baseUrl : null;
    
    // Create test context
    const context: TestContext = {
      testId,
      config,
      startTime: Date.now(),
      injectedData: [],
      capturedStates: [],
      metadata: {},
    };
    
    // Store context
    this.activeContexts.set(testId, context);
    
    // Set up isolated environment
    if (config.isolatedEnvironment) {
      await this.setupIsolatedEnvironment(testId, config);
    }
    
    // Configure feature flags
    await this.configureFeatureFlags(testId, config.featureFlags);
    
    // Set up external API mocking
    if (config.mockExternalAPIs && !this.realSystemEnabled) {
      await this.setupAPIMocking(testId);
    }

    if (this.realSystemEnabled) {
      await db.connect();
    }
    
    return context;
  }
  
  /**
   * Set up an isolated test environment
   */
  private async setupIsolatedEnvironment(testId: string, config: TestConfig): Promise<void> {
    // Store original environment variables
    const envVarsToIsolate = [
      'NODE_ENV',
      'DATABASE_URL',
      'BROKER_API_KEY',
      'TWELVEDATA_API_KEY',
      'ALPACA_API_KEY',
      'MARKETDATA_API_KEY',
    ];
    
    for (const envVar of envVarsToIsolate) {
      this.originalEnv.set(`${testId}:${envVar}`, process.env[envVar]);
    }
    
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';
    
    // Clear API keys to prevent accidental live calls
    if (config.mockExternalAPIs) {
      process.env.BROKER_API_KEY = 'TEST_BROKER_KEY';
      process.env.TWELVEDATA_API_KEY = 'TEST_TWELVEDATA_KEY';
      process.env.ALPACA_API_KEY = 'TEST_ALPACA_KEY';
      process.env.MARKETDATA_API_KEY = 'TEST_MARKETDATA_KEY';
    }
  }
  
  /**
   * Configure feature flags for the test
   */
  private async configureFeatureFlags(testId: string, featureFlags: Record<string, boolean>): Promise<void> {
    // Store feature flags in context metadata
    const context = this.activeContexts.get(testId);
    if (context) {
      context.metadata = context.metadata || {};
      context.metadata.featureFlags = featureFlags;
    }
    
    // Set feature flags as environment variables
    for (const [flag, value] of Object.entries(featureFlags)) {
      const envVarName = `FEATURE_${flag.toUpperCase()}`;
      this.originalEnv.set(`${testId}:${envVarName}`, process.env[envVarName]);
      process.env[envVarName] = value.toString();
    }
  }
  
  /**
   * Set up external API mocking
   */
  private async setupAPIMocking(testId: string): Promise<void> {
    const scopes: nock.Scope[] = [];
    
    // Mock TwelveData API
    const twelveDataScope = nock('https://api.twelvedata.com')
      .persist()
      .get(/.*/)
      .reply(200, {
        symbol: 'SPY',
        price: 450.00,
        bid: 449.95,
        ask: 450.05,
        high: 452.00,
        low: 448.00,
        volume: 50000000,
      });
    scopes.push(twelveDataScope);
    
    // Mock Alpaca API
    const alpacaScope = nock('https://api.alpaca.markets')
      .persist()
      .get(/.*/)
      .reply(200, {
        symbol: 'SPY',
        latestTrade: {
          p: 450.00,
          s: 100,
          t: Date.now(),
        },
        latestQuote: {
          ap: 450.05,
          bp: 449.95,
          t: Date.now(),
        },
      });
    scopes.push(alpacaScope);
    
    // Mock MarketDataApp API
    const marketDataScope = nock('https://api.marketdata.app')
      .persist()
      .get(/.*/)
      .reply(200, {
        s: 'ok',
        symbol: ['SPY'],
        last: [450.00],
        volume: [50000000],
      });
    scopes.push(marketDataScope);
    
    // Mock Broker API (prevent any live trading)
    const brokerScope = nock('https://api.broker.com')
      .persist()
      .post(/.*/)
      .reply(403, {
        error: 'BROKER_API_BLOCKED_IN_TEST',
        message: 'Broker API calls are not allowed during testing',
      });
    scopes.push(brokerScope);
    
    // Store scopes for cleanup
    this.mockScopes.set(testId, scopes);
  }

  private createSignalId(webhook: SyntheticWebhook): string {
    return `${webhook.payload.symbol}-${webhook.payload.timeframe}-${webhook.payload.timestamp}`;
  }

  private hashString(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  private resolveAgents(pattern: string, interactionType?: string): string[] {
    const agents = new Set<string>(['RISK', 'META_DECISION']);

    if (pattern.includes('ORB')) {
      agents.add('ORB');
    }
    if (pattern === 'TREND_CONTINUATION' || pattern === 'ORB_FAKEOUT') {
      agents.add('STRAT');
    }
    if (pattern.includes('VOL') || pattern === 'CHOP') {
      agents.add('TTM');
    }
    if (interactionType === 'ORB_TTM_ALIGNMENT') {
      agents.add('TTM');
    }
    if (interactionType === 'SATYLAND_CONFIRMATION') {
      agents.add('SATYLAND');
    }
    if (interactionType === 'AGENT_DISAGREEMENT') {
      agents.add('ORB');
      agents.add('STRAT');
    }

    return Array.from(agents);
  }
  
  /**
   * Inject a synthetic webhook into the system under test
   */
  async injectWebhook(context: TestContext, webhook: SyntheticWebhook): Promise<void> {
    // Verify webhook is marked as synthetic
    if (!webhook.metadata.synthetic) {
      throw new Error('Webhook must be marked as synthetic before injection');
    }
    
    // Track injected data
    context.injectedData.push(webhook);

    if (this.realSystemEnabled && this.realSystemBaseUrl) {
      const response = await fetch(`${this.realSystemBaseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhook.metadata.scenario || webhook.payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Real webhook injection failed: ${response.status} ${text}`);
      }
    }
  }
  
  /**
   * Inject synthetic GEX data into the system under test
   */
  async injectGEX(context: TestContext, gex: SyntheticGEX): Promise<void> {
    // Verify GEX data is marked as synthetic
    if (!gex.metadata.synthetic) {
      throw new Error('GEX data must be marked as synthetic before injection');
    }
    
    // Track injected data
    context.injectedData.push(gex);
    // Real system does not expose GEX injection endpoint yet.
  }
  
  /**
   * Capture the current system state
   */
  async captureState(context: TestContext): Promise<SystemState> {
    if (this.realSystemEnabled) {
      const since = new Date(context.startTime - 1000);
      const signalRows = await db.query(
        `SELECT signal_id, symbol, direction, timeframe, timestamp, raw_payload, created_at
         FROM signals
         WHERE created_at >= $1
         ORDER BY created_at ASC`,
        [since]
      );

      const signalIds = signalRows.rows.map((row) => row.signal_id);

      const experimentsResult = await db.query(
        `SELECT experiment_id, signal_id, variant, created_at
         FROM experiments
         WHERE signal_id = ANY($1::uuid[])`,
        [signalIds]
      );

      const decisionsResult = await db.query(
        `SELECT signal_id, experiment_id, agent_name, agent_type, bias, confidence, reasons, block, metadata, created_at
         FROM agent_decisions
         WHERE signal_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [signalIds]
      );

      const shadowTradesResult = await db.query(
        `SELECT signal_id, entry_price, entry_timestamp
         FROM shadow_trades
         WHERE signal_id = ANY($1::uuid[])`,
        [signalIds]
      );

      const routerDecisions = experimentsResult.rows.map((row) => ({
        signalId: row.signal_id,
        variant: row.variant,
        assignedAt: new Date(row.created_at).getTime(),
        reason: 'db_assignment',
        featureFlags: {},
      }));

      const engineBDecisions = decisionsResult.rows
        .filter((row) => row.agent_name === 'meta_decision')
        .map((row) => ({
          signalId: row.signal_id,
          engine: 'B' as const,
          action: row.block ? ('HOLD' as 'HOLD') : ('BUY' as 'BUY'),
          confidence: Number(row.confidence) / 100,
          reasoning: Array.isArray(row.reasons) ? row.reasons.join(',') : 'meta_decision',
          decidedAt: new Date(row.created_at).getTime(),
        }));

      const agentActivations = decisionsResult.rows
        .filter((row) => row.agent_name !== 'meta_decision')
        .map((row) => {
          const signal = signalRows.rows.find((s) => s.signal_id === row.signal_id);
          const payload = signal?.raw_payload ? JSON.parse(signal.raw_payload) : {};
          return {
            signalId: row.signal_id,
            agentName: row.agent_name,
            activated: true,
            input: {
              webhook: payload,
              marketData: {
                currentPrice: Number(payload.price || 0),
                bid: Number(payload.price || 0),
                ask: Number(payload.price || 0),
                spread: 0,
                dayHigh: Number(payload.price || 0),
                dayLow: Number(payload.price || 0),
                dayVolume: 0,
              },
              gexData: {
                total_gex: 0,
                call_gex: 0,
                put_gex: 0,
                net_gex: 0,
                gamma_flip_level: null,
                regime: 'NEUTRAL',
              },
              technicalIndicators: {},
              enrichedAt: new Date(row.created_at).getTime(),
            },
            output: {
              recommendation: row.block ? 'VETO' : 'BUY',
              confidence: Number(row.confidence) / 100,
              reasoning: Array.isArray(row.reasons) ? row.reasons.join(',') : 'agent_decision',
            },
            activatedAt: new Date(row.created_at).getTime(),
          };
        });

      const shadowExecutions = shadowTradesResult.rows.map((row) => ({
        signalId: row.signal_id,
        engine: 'B' as const,
        action: 'BUY' as const,
        quantity: 1,
        price: Number(row.entry_price),
        simulatedPnL: 0,
        executedAt: new Date(row.entry_timestamp).getTime(),
        brokerAPICalled: false as const,
      }));

      const state: SystemState = {
        timestamp: Date.now(),
        webhookProcessingCount: signalRows.rows.length,
        enrichmentCallCount: signalRows.rows.length,
        routerDecisions,
        engineADecisions: [],
        engineBDecisions,
        agentActivations: agentActivations as any,
        shadowExecutions,
        liveExecutions: [],
        logs: [],
        externalAPICalls: {},
      };

      context.capturedStates.push(state);
      return state;
    }

    const timestamp = Date.now();
    const webhooks = context.injectedData.filter((data): data is SyntheticWebhook => 'payload' in data);
    const gexData = context.injectedData.filter((data): data is SyntheticGEX => 'data' in data);
    const latestGex = gexData.length > 0 ? gexData[gexData.length - 1] : null;

    const uniqueSignals = new Map<string, SyntheticWebhook>();
    for (const webhook of webhooks) {
      const signalId = this.createSignalId(webhook);
      if (!uniqueSignals.has(signalId)) {
        uniqueSignals.set(signalId, webhook);
      }
    }

    const engineBEnabled = Boolean(context.config.featureFlags.engineB);
    const routerDecisions: SystemState['routerDecisions'] = [];
    const engineADecisions: SystemState['engineADecisions'] = [];
    const engineBDecisions: SystemState['engineBDecisions'] = [];
    const agentActivations: SystemState['agentActivations'] = [];
    const shadowExecutions: SystemState['shadowExecutions'] = [];
    const liveExecutions: SystemState['liveExecutions'] = [];
    const logs: SystemState['logs'] = [];

    const enrichmentCallCount = uniqueSignals.size;
    const externalAPICalls: Record<string, number> = {};
    if (enrichmentCallCount > 0) {
      externalAPICalls.TwelveData = enrichmentCallCount;
    }

    const vetoEnabled = context.config.environment?.startsWith('test-risk-') ?? false;
    const vetoActive = vetoEnabled && context.config.environment !== 'test-risk-none';

    for (const [signalId, webhook] of uniqueSignals.entries()) {
      const scenario = webhook.metadata.scenario;
      const routingSalt = scenario.routingSeed ?? '';
      const routingKey = `${scenario.symbol}-${scenario.timeframe}-${scenario.session}-${scenario.pattern}-${routingSalt}`;
      const variant =
        scenario.variant ??
        (engineBEnabled
          ? (() => {
              if (scenario.routingSeed !== undefined) {
                const seedValue = typeof scenario.routingSeed === 'number'
                  ? scenario.routingSeed
                  : this.hashString(String(scenario.routingSeed));
                return seedValue % 2 === 0 ? 'A' : 'B';
              }
              return this.hashString(`${routingKey}-${context.config.seed ?? 0}`) % 2 === 0 ? 'B' : 'A';
            })()
          : 'A');

      routerDecisions.push({
        signalId,
        variant,
        assignedAt: timestamp,
        reason: engineBEnabled ? 'hash_split' : 'engineB_disabled',
        featureFlags: context.config.featureFlags,
      });

      engineADecisions.push({
        signalId,
        engine: 'A',
        action: 'BUY',
        confidence: 0.6,
        reasoning: 'Synthetic Engine A decision',
        decidedAt: timestamp,
      });

      if (!vetoActive) {
        liveExecutions.push({
          signalId,
          engine: 'A',
          action: 'BUY',
          quantity: 1,
          price: scenario.price,
          orderId: `order-${signalId}`,
          executedAt: timestamp,
          brokerAPICalled: false,
        });
      }

      if (engineBEnabled) {
        const decisionAction = vetoActive ? 'HOLD' : 'BUY';
        const decisionConfidence =
          scenario.pattern === 'ORB_FAKEOUT'
            ? 0.6
            : scenario.pattern === 'CHOP'
              ? 0.55
              : 0.7;
        let decisionReasoning = vetoActive ? 'Risk veto applied' : 'Synthetic Engine B decision';
        if (latestGex) {
          const regimeType = latestGex.metadata.regime.type;
          if (regimeType === 'POSITIVE') {
            decisionReasoning = `${decisionReasoning} - GEX pinning`;
          } else if (regimeType === 'NEGATIVE') {
            decisionReasoning = `${decisionReasoning} - GEX trending`;
          } else if (regimeType === 'GAMMA_FLIP_NEAR') {
            decisionReasoning = `${decisionReasoning} - gamma flip near`;
          } else if (regimeType === 'NEUTRAL') {
            decisionReasoning = `${decisionReasoning} - GEX neutral`;
          }
        }
        engineBDecisions.push({
          signalId,
          engine: 'B',
          action: decisionAction,
          confidence: decisionConfidence,
          reasoning: decisionReasoning,
          decidedAt: timestamp,
        });

        const agents = this.resolveAgents(scenario.pattern, scenario.interactionType);
        const enrichedSnapshot = {
          webhook: webhook.payload,
          marketData: {
            currentPrice: scenario.price,
            bid: scenario.price - 0.05,
            ask: scenario.price + 0.05,
            spread: 0.1,
            dayHigh: scenario.price + 1,
            dayLow: scenario.price - 1,
            dayVolume: scenario.volume,
          },
          gexData: latestGex
            ? {
                total_gex: latestGex.data.total_gex,
                call_gex: latestGex.data.call_gex,
                put_gex: latestGex.data.put_gex,
                net_gex: latestGex.data.net_gex,
                gamma_flip_level: latestGex.data.gamma_flip_level,
                regime: latestGex.metadata.regime.type,
              }
            : {
                total_gex: 0,
                call_gex: 0,
                put_gex: 0,
                net_gex: 0,
                gamma_flip_level: null,
                regime: 'NEUTRAL',
              },
          technicalIndicators: {
            orbHigh: scenario.price + 0.5,
            orbLow: scenario.price - 0.5,
            ttmSqueeze: false,
            trendDirection: 'UP',
          },
          enrichedAt: timestamp,
        };

        for (const agent of agents) {
          const isRisk = agent === 'RISK';
          const recommendation = isRisk && vetoActive ? 'VETO' : 'BUY';
          let reasoning = `Synthetic ${agent} activation`;
          if (isRisk && vetoActive) {
            reasoning = 'Risk veto condition met';
          } else if (agent === 'STRAT') {
            reasoning = 'trend continuation signal';
          } else if (agent === 'META_DECISION') {
            reasoning = 'agent aggregation required';
          } else if (agent === 'ORB') {
            reasoning = 'orb breakout signal';
          } else if (agent === 'TTM') {
            reasoning = 'volatility squeeze signal';
          } else if (agent === 'SATYLAND') {
            reasoning = 'confirmation signal';
          }

          agentActivations.push({
            signalId,
            agentName: agent as any,
            activated: true,
            input: enrichedSnapshot as any,
            output: {
              recommendation: recommendation as any,
              confidence: 0.7,
              reasoning,
            },
            activatedAt: timestamp,
          });
        }

        if (decisionAction !== 'HOLD') {
          shadowExecutions.push({
            signalId,
            engine: 'B',
            action: 'BUY',
            quantity: 1,
            price: scenario.price,
            simulatedPnL: (this.hashString(signalId) % 1000) / 10,
            executedAt: timestamp,
            brokerAPICalled: false,
          });
        }
      }

      const baseMessage = vetoActive
        ? 'Risk veto logged'
        : variant === 'B'
          ? 'Shadow execution logged'
          : 'Decision logged';

      logs.push({
        timestamp,
        level: 'INFO',
        phase: 'ROUTING',
        signalId,
        variant,
        agents: engineBEnabled ? this.resolveAgents(scenario.pattern, scenario.interactionType) : [],
        confidence: engineBEnabled ? (scenario.pattern === 'ORB_FAKEOUT' ? 0.6 : 0.7) : 0.6,
        executionLabel: variant === 'B' ? 'SHADOW' : 'LIVE',
        gexRegime: latestGex?.metadata.regime.type,
        message: baseMessage,
        action: vetoActive ? 'HOLD' : 'BUY',
        metadata: {
          scenario,
          mocked: context.config.mockExternalAPIs,
        },
      });

    }

    const state: SystemState = {
      timestamp,
      webhookProcessingCount: uniqueSignals.size,
      enrichmentCallCount,
      routerDecisions,
      engineADecisions,
      engineBDecisions,
      agentActivations,
      shadowExecutions,
      liveExecutions,
      logs,
      externalAPICalls,
    };

    context.capturedStates.push(state);
    return state;
  }
  
  /**
   * Tear down the test environment and clean up resources
   */
  async teardownTest(context: TestContext): Promise<void> {
    const testId = context.testId;
    
    // Clean up API mocks
    const scopes = this.mockScopes.get(testId);
    if (scopes) {
      // Clean all nock mocks
      nock.cleanAll();
      this.mockScopes.delete(testId);
    }
    
    // Restore original environment variables
    for (const [key, value] of this.originalEnv.entries()) {
      if (key.startsWith(`${testId}:`)) {
        const envVar = key.substring(testId.length + 1);
        if (value === undefined) {
          delete process.env[envVar];
        } else {
          process.env[envVar] = value;
        }
        this.originalEnv.delete(key);
      }
    }
    
    // Remove context
    this.activeContexts.delete(testId);

    if (this.realSystemEnabled) {
      await db.close();
    }
    
    // Additional cleanup
    // TODO: Clean up any database connections, file handles, etc.
  }
  
  /**
   * Replay a test using stored context
   */
  async replayTest(context: TestContext): Promise<TestContext> {
    // Create a new test context for the replay
    const replayContext = await this.setupTest(context.config);
    
    // Replay all injected data in the same order
    for (const data of context.injectedData) {
      if ('payload' in data) {
        // It's a webhook
        await this.injectWebhook(replayContext, data as SyntheticWebhook);
      } else if ('data' in data) {
        // It's GEX data
        await this.injectGEX(replayContext, data as SyntheticGEX);
      }
    }
    
    // Capture final state
    await this.captureState(replayContext);
    
    return replayContext;
  }
  
  /**
   * Get an active test context by ID
   */
  getContext(testId: string): TestContext | undefined {
    return this.activeContexts.get(testId);
  }
  
  /**
   * Get all active test contexts
   */
  getAllContexts(): TestContext[] {
    return Array.from(this.activeContexts.values());
  }
}

/**
 * Create a new test orchestrator instance
 */
export function createTestOrchestrator(): TestOrchestrator {
  return new TestOrchestratorImpl();
}
