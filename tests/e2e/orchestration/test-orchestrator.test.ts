/**
 * Unit Tests for Test Orchestrator
 * 
 * These tests verify the test orchestrator's ability to:
 * - Set up and tear down isolated test environments
 * - Configure feature flags
 * - Mock external APIs
 * - Inject synthetic data
 * - Capture system state
 * - Replay tests deterministically
 * 
 * Requirements: 3.1, 3.2, 3.3, 14.1, 14.2, 13.5
 */

import nock from 'nock';
import { createTestOrchestrator, TestOrchestratorImpl } from './test-orchestrator-impl';
import { TestConfig, TestContext } from './test-orchestrator';
import { SyntheticWebhook, WebhookScenario } from '../generators/webhook-generator';
import { SyntheticGEX, GEXRegime } from '../generators/gex-generator';

describe('TestOrchestrator', () => {
  let orchestrator: TestOrchestratorImpl;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    orchestrator = createTestOrchestrator() as TestOrchestratorImpl;
    // Store original environment
    originalEnv = { ...process.env };
    // Clean up any existing nock mocks
    nock.cleanAll();
  });

  afterEach(async () => {
    // Clean up all active contexts
    const contexts = orchestrator.getAllContexts();
    for (const context of contexts) {
      await orchestrator.teardownTest(context);
    }
    // Restore original environment
    process.env = originalEnv;
    // Clean up nock
    nock.cleanAll();
  });

  describe('setupTest', () => {
    it('should create a test context with unique ID', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      expect(context).toBeDefined();
      expect(context.testId).toBeDefined();
      expect(context.testId).toMatch(/^test-\d+-\d+$/);
      expect(context.config).toEqual(config);
      expect(context.startTime).toBeGreaterThan(0);
      expect(context.injectedData).toEqual([]);
      expect(context.capturedStates).toEqual([]);
    });

    it('should create unique test IDs for multiple tests', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context1 = await orchestrator.setupTest(config);
      const context2 = await orchestrator.setupTest(config);

      expect(context1.testId).not.toEqual(context2.testId);
    });

    it('should set up isolated environment when configured', async () => {
      const config: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: {},
        mockExternalAPIs: true,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.BROKER_API_KEY).toBe('TEST_BROKER_KEY');
      expect(process.env.TWELVEDATA_API_KEY).toBe('TEST_TWELVEDATA_KEY');
      expect(process.env.ALPACA_API_KEY).toBe('TEST_ALPACA_KEY');
      expect(process.env.MARKETDATA_API_KEY).toBe('TEST_MARKETDATA_KEY');

      await orchestrator.teardownTest(context);
    });

    it('should configure feature flags', async () => {
      const config: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: {
          engine_b: true,
          multi_agent: true,
          shadow_execution: true,
        },
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      expect(process.env.FEATURE_ENGINE_B).toBe('true');
      expect(process.env.FEATURE_MULTI_AGENT).toBe('true');
      expect(process.env.FEATURE_SHADOW_EXECUTION).toBe('true');
      expect(context.metadata?.featureFlags).toEqual(config.featureFlags);

      await orchestrator.teardownTest(context);
    });

    it('should set up API mocking when configured', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: true,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      // Verify nock interceptors are set up
      expect(nock.activeMocks().length).toBeGreaterThan(0);

      await orchestrator.teardownTest(context);
    });

    it('should store context for retrieval', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);
      const retrieved = orchestrator.getContext(context.testId);

      expect(retrieved).toBe(context);

      await orchestrator.teardownTest(context);
    });
  });

  describe('teardownTest', () => {
    it('should clean up API mocks', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: true,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);
      expect(nock.activeMocks().length).toBeGreaterThan(0);

      await orchestrator.teardownTest(context);
      expect(nock.activeMocks().length).toBe(0);
    });

    it('should restore original environment variables', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalBrokerKey = process.env.BROKER_API_KEY;

      const config: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: { test_flag: true },
        mockExternalAPIs: true,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.FEATURE_TEST_FLAG).toBe('true');

      await orchestrator.teardownTest(context);
      expect(process.env.NODE_ENV).toBe(originalNodeEnv);
      expect(process.env.BROKER_API_KEY).toBe(originalBrokerKey);
      expect(process.env.FEATURE_TEST_FLAG).toBeUndefined();
    });

    it('should remove context from active contexts', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);
      expect(orchestrator.getContext(context.testId)).toBeDefined();

      await orchestrator.teardownTest(context);
      expect(orchestrator.getContext(context.testId)).toBeUndefined();
    });

    it('should handle multiple teardowns gracefully', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);
      await orchestrator.teardownTest(context);
      
      // Second teardown should not throw
      await expect(orchestrator.teardownTest(context)).resolves.not.toThrow();
    });
  });

  describe('injectWebhook', () => {
    let context: TestContext;

    beforeEach(async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };
      context = await orchestrator.setupTest(config);
    });

    afterEach(async () => {
      await orchestrator.teardownTest(context);
    });

    it('should inject synthetic webhook and track it', async () => {
      const scenario: WebhookScenario = {
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT',
        price: 450.00,
        volume: 1000000,
        timestamp: Date.now(),
      };

      const webhook: SyntheticWebhook = {
        payload: {
          symbol: scenario.symbol,
          timeframe: scenario.timeframe,
          timestamp: scenario.timestamp,
          open: scenario.price,
          high: scenario.price + 1,
          low: scenario.price - 1,
          close: scenario.price + 0.5,
          volume: scenario.volume,
        },
        metadata: {
          synthetic: true,
          scenario,
          generatedAt: Date.now(),
        },
      };

      await orchestrator.injectWebhook(context, webhook);

      expect(context.injectedData).toHaveLength(1);
      expect(context.injectedData[0]).toBe(webhook);
    });

    it('should reject webhook without synthetic flag', async () => {
      const webhook = {
        payload: {
          symbol: 'SPY',
          timeframe: '5m',
          timestamp: Date.now(),
          open: 450,
          high: 451,
          low: 449,
          close: 450.5,
          volume: 1000000,
        },
        metadata: {
          synthetic: false, // Not marked as synthetic
          scenario: {} as WebhookScenario,
          generatedAt: Date.now(),
        },
      } as unknown as SyntheticWebhook;

      await expect(orchestrator.injectWebhook(context, webhook))
        .rejects.toThrow('Webhook must be marked as synthetic before injection');
    });

    it('should track multiple webhook injections', async () => {
      const webhooks: SyntheticWebhook[] = [
        {
          payload: {
            symbol: 'SPY',
            timeframe: '5m',
            timestamp: Date.now(),
            open: 450,
            high: 451,
            low: 449,
            close: 450.5,
            volume: 1000000,
          },
          metadata: {
            synthetic: true,
            scenario: {} as WebhookScenario,
            generatedAt: Date.now(),
          },
        },
        {
          payload: {
            symbol: 'QQQ',
            timeframe: '15m',
            timestamp: Date.now(),
            open: 380,
            high: 381,
            low: 379,
            close: 380.5,
            volume: 500000,
          },
          metadata: {
            synthetic: true,
            scenario: {} as WebhookScenario,
            generatedAt: Date.now(),
          },
        },
      ];

      for (const webhook of webhooks) {
        await orchestrator.injectWebhook(context, webhook);
      }

      expect(context.injectedData).toHaveLength(2);
    });

    it('should maintain injection order', async () => {
      const webhooks: SyntheticWebhook[] = [];
      for (let i = 0; i < 5; i++) {
        const webhook: SyntheticWebhook = {
          payload: {
            symbol: 'SPY',
            timeframe: '5m',
            timestamp: Date.now() + i,
            open: 450 + i,
            high: 451 + i,
            low: 449 + i,
            close: 450.5 + i,
            volume: 1000000,
          },
          metadata: {
            synthetic: true,
            scenario: {} as WebhookScenario,
            generatedAt: Date.now(),
          },
        };
        webhooks.push(webhook);
        await orchestrator.injectWebhook(context, webhook);
      }

      expect(context.injectedData).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(context.injectedData[i]).toBe(webhooks[i]);
      }
    });
  });

  describe('injectGEX', () => {
    let context: TestContext;

    beforeEach(async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };
      context = await orchestrator.setupTest(config);
    });

    afterEach(async () => {
      await orchestrator.teardownTest(context);
    });

    it('should inject synthetic GEX data and track it', async () => {
      const regime: GEXRegime = {
        type: 'POSITIVE',
        symbol: 'SPY',
        spotPrice: 450.00,
      };

      const gex: SyntheticGEX = {
        data: {
          total_gex: 1000000,
          call_gex: 600000,
          put_gex: 400000,
          net_gex: 200000,
          gamma_flip_level: null,
        },
        metadata: {
          synthetic: true,
          regime,
          generatedAt: Date.now(),
        },
      };

      await orchestrator.injectGEX(context, gex);

      expect(context.injectedData).toHaveLength(1);
      expect(context.injectedData[0]).toBe(gex);
    });

    it('should reject GEX data without synthetic flag', async () => {
      const gex = {
        data: {
          total_gex: 1000000,
          call_gex: 600000,
          put_gex: 400000,
          net_gex: 200000,
          gamma_flip_level: null,
        },
        metadata: {
          synthetic: false, // Not marked as synthetic
          regime: {} as GEXRegime,
          generatedAt: Date.now(),
        },
      } as unknown as SyntheticGEX;

      await expect(orchestrator.injectGEX(context, gex))
        .rejects.toThrow('GEX data must be marked as synthetic before injection');
    });

    it('should track multiple GEX injections', async () => {
      const gexData: SyntheticGEX[] = [
        {
          data: {
            total_gex: 1000000,
            call_gex: 600000,
            put_gex: 400000,
            net_gex: 200000,
            gamma_flip_level: null,
          },
          metadata: {
            synthetic: true,
            regime: {} as GEXRegime,
            generatedAt: Date.now(),
          },
        },
        {
          data: {
            total_gex: -500000,
            call_gex: 200000,
            put_gex: 700000,
            net_gex: -500000,
            gamma_flip_level: 445.00,
          },
          metadata: {
            synthetic: true,
            regime: {} as GEXRegime,
            generatedAt: Date.now(),
          },
        },
      ];

      for (const gex of gexData) {
        await orchestrator.injectGEX(context, gex);
      }

      expect(context.injectedData).toHaveLength(2);
    });
  });

  describe('captureState', () => {
    let context: TestContext;

    beforeEach(async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };
      context = await orchestrator.setupTest(config);
    });

    afterEach(async () => {
      await orchestrator.teardownTest(context);
    });

    it('should capture system state', async () => {
      const state = await orchestrator.captureState(context);

      expect(state).toBeDefined();
      expect(state.timestamp).toBeGreaterThan(0);
      expect(state.webhookProcessingCount).toBeDefined();
      expect(state.enrichmentCallCount).toBeDefined();
      expect(state.routerDecisions).toEqual([]);
      expect(state.engineADecisions).toEqual([]);
      expect(state.engineBDecisions).toEqual([]);
      expect(state.agentActivations).toEqual([]);
      expect(state.shadowExecutions).toEqual([]);
      expect(state.liveExecutions).toEqual([]);
      expect(state.logs).toEqual([]);
      expect(state.externalAPICalls).toEqual({});
    });

    it('should store captured state in context', async () => {
      expect(context.capturedStates).toHaveLength(0);

      await orchestrator.captureState(context);
      expect(context.capturedStates).toHaveLength(1);

      await orchestrator.captureState(context);
      expect(context.capturedStates).toHaveLength(2);
    });

    it('should capture state with increasing timestamps', async () => {
      const state1 = await orchestrator.captureState(context);
      
      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const state2 = await orchestrator.captureState(context);

      expect(state2.timestamp).toBeGreaterThan(state1.timestamp);
    });

    it('should capture state multiple times without interference', async () => {
      const states = [];
      for (let i = 0; i < 5; i++) {
        states.push(await orchestrator.captureState(context));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      expect(context.capturedStates).toHaveLength(5);
      
      // Verify timestamps are increasing
      for (let i = 1; i < states.length; i++) {
        expect(states[i].timestamp).toBeGreaterThanOrEqual(states[i - 1].timestamp);
      }
    });
  });

  describe('replayTest', () => {
    let originalContext: TestContext;

    beforeEach(async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: { test_flag: true },
        mockExternalAPIs: false,
        captureAllLogs: false,
      };
      originalContext = await orchestrator.setupTest(config);
    });

    afterEach(async () => {
      await orchestrator.teardownTest(originalContext);
    });

    it('should create a new context for replay', async () => {
      const replayContext = await orchestrator.replayTest(originalContext);

      expect(replayContext.testId).not.toEqual(originalContext.testId);
      expect(replayContext.config).toEqual(originalContext.config);

      await orchestrator.teardownTest(replayContext);
    });

    it('should replay injected webhooks in order', async () => {
      const webhooks: SyntheticWebhook[] = [
        {
          payload: {
            symbol: 'SPY',
            timeframe: '5m',
            timestamp: Date.now(),
            open: 450,
            high: 451,
            low: 449,
            close: 450.5,
            volume: 1000000,
          },
          metadata: {
            synthetic: true,
            scenario: {} as WebhookScenario,
            generatedAt: Date.now(),
          },
        },
        {
          payload: {
            symbol: 'QQQ',
            timeframe: '15m',
            timestamp: Date.now(),
            open: 380,
            high: 381,
            low: 379,
            close: 380.5,
            volume: 500000,
          },
          metadata: {
            synthetic: true,
            scenario: {} as WebhookScenario,
            generatedAt: Date.now(),
          },
        },
      ];

      for (const webhook of webhooks) {
        await orchestrator.injectWebhook(originalContext, webhook);
      }

      const replayContext = await orchestrator.replayTest(originalContext);

      expect(replayContext.injectedData).toHaveLength(2);
      expect(replayContext.injectedData[0]).toEqual(webhooks[0]);
      expect(replayContext.injectedData[1]).toEqual(webhooks[1]);

      await orchestrator.teardownTest(replayContext);
    });

    it('should replay injected GEX data in order', async () => {
      const gexData: SyntheticGEX[] = [
        {
          data: {
            total_gex: 1000000,
            call_gex: 600000,
            put_gex: 400000,
            net_gex: 200000,
            gamma_flip_level: null,
          },
          metadata: {
            synthetic: true,
            regime: {} as GEXRegime,
            generatedAt: Date.now(),
          },
        },
        {
          data: {
            total_gex: -500000,
            call_gex: 200000,
            put_gex: 700000,
            net_gex: -500000,
            gamma_flip_level: 445.00,
          },
          metadata: {
            synthetic: true,
            regime: {} as GEXRegime,
            generatedAt: Date.now(),
          },
        },
      ];

      for (const gex of gexData) {
        await orchestrator.injectGEX(originalContext, gex);
      }

      const replayContext = await orchestrator.replayTest(originalContext);

      expect(replayContext.injectedData).toHaveLength(2);
      expect(replayContext.injectedData[0]).toEqual(gexData[0]);
      expect(replayContext.injectedData[1]).toEqual(gexData[1]);

      await orchestrator.teardownTest(replayContext);
    });

    it('should replay mixed webhook and GEX data in order', async () => {
      const webhook: SyntheticWebhook = {
        payload: {
          symbol: 'SPY',
          timeframe: '5m',
          timestamp: Date.now(),
          open: 450,
          high: 451,
          low: 449,
          close: 450.5,
          volume: 1000000,
        },
        metadata: {
          synthetic: true,
          scenario: {} as WebhookScenario,
          generatedAt: Date.now(),
        },
      };

      const gex: SyntheticGEX = {
        data: {
          total_gex: 1000000,
          call_gex: 600000,
          put_gex: 400000,
          net_gex: 200000,
          gamma_flip_level: null,
        },
        metadata: {
          synthetic: true,
          regime: {} as GEXRegime,
          generatedAt: Date.now(),
        },
      };

      await orchestrator.injectWebhook(originalContext, webhook);
      await orchestrator.injectGEX(originalContext, gex);

      const replayContext = await orchestrator.replayTest(originalContext);

      expect(replayContext.injectedData).toHaveLength(2);
      expect(replayContext.injectedData[0]).toEqual(webhook);
      expect(replayContext.injectedData[1]).toEqual(gex);

      await orchestrator.teardownTest(replayContext);
    });

    it('should capture state after replay', async () => {
      const replayContext = await orchestrator.replayTest(originalContext);

      expect(replayContext.capturedStates.length).toBeGreaterThan(0);

      await orchestrator.teardownTest(replayContext);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete test lifecycle', async () => {
      // Setup
      const config: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: { engine_b: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };

      const context = await orchestrator.setupTest(config);
      expect(context.testId).toBeDefined();

      // Inject data
      const webhook: SyntheticWebhook = {
        payload: {
          symbol: 'SPY',
          timeframe: '5m',
          timestamp: Date.now(),
          open: 450,
          high: 451,
          low: 449,
          close: 450.5,
          volume: 1000000,
        },
        metadata: {
          synthetic: true,
          scenario: {} as WebhookScenario,
          generatedAt: Date.now(),
        },
      };

      await orchestrator.injectWebhook(context, webhook);

      const gex: SyntheticGEX = {
        data: {
          total_gex: 1000000,
          call_gex: 600000,
          put_gex: 400000,
          net_gex: 200000,
          gamma_flip_level: null,
        },
        metadata: {
          synthetic: true,
          regime: {} as GEXRegime,
          generatedAt: Date.now(),
        },
      };

      await orchestrator.injectGEX(context, gex);

      // Capture state
      const state = await orchestrator.captureState(context);
      expect(state).toBeDefined();

      // Replay
      const replayContext = await orchestrator.replayTest(context);
      expect(replayContext.injectedData).toHaveLength(2);

      // Teardown
      await orchestrator.teardownTest(context);
      await orchestrator.teardownTest(replayContext);

      expect(orchestrator.getContext(context.testId)).toBeUndefined();
      expect(orchestrator.getContext(replayContext.testId)).toBeUndefined();
    });

    it('should isolate multiple concurrent tests', async () => {
      const config1: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: { test1: true },
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const config2: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: { test2: true },
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context1 = await orchestrator.setupTest(config1);
      const context2 = await orchestrator.setupTest(config2);

      expect(context1.testId).not.toEqual(context2.testId);
      expect(context1.metadata?.featureFlags).toEqual({ test1: true });
      expect(context2.metadata?.featureFlags).toEqual({ test2: true });

      await orchestrator.teardownTest(context1);
      await orchestrator.teardownTest(context2);
    });
  });

  describe('error handling', () => {
    it('should handle teardown of non-existent context', async () => {
      const fakeContext: TestContext = {
        testId: 'non-existent',
        config: {
          isolatedEnvironment: false,
          featureFlags: {},
          mockExternalAPIs: false,
          captureAllLogs: false,
        },
        startTime: Date.now(),
        injectedData: [],
        capturedStates: [],
      };

      await expect(orchestrator.teardownTest(fakeContext)).resolves.not.toThrow();
    });

    it('should handle state capture errors gracefully', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      // State capture should not throw even if system under test is not available
      await expect(orchestrator.captureState(context)).resolves.toBeDefined();

      await orchestrator.teardownTest(context);
    });

    it('should handle empty replay gracefully', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      // Replay with no injected data should work
      const replayContext = await orchestrator.replayTest(context);
      expect(replayContext.injectedData).toHaveLength(0);

      await orchestrator.teardownTest(context);
      await orchestrator.teardownTest(replayContext);
    });

    it('should handle API mocking setup failures gracefully', async () => {
      const config: TestConfig = {
        isolatedEnvironment: false,
        featureFlags: {},
        mockExternalAPIs: true,
        captureAllLogs: false,
      };

      // Setup should succeed even if nock is already configured
      const context1 = await orchestrator.setupTest(config);
      const context2 = await orchestrator.setupTest(config);

      expect(context1.testId).toBeDefined();
      expect(context2.testId).toBeDefined();

      await orchestrator.teardownTest(context1);
      await orchestrator.teardownTest(context2);
    });

    it('should handle feature flag configuration with special characters', async () => {
      const config: TestConfig = {
        isolatedEnvironment: true,
        featureFlags: {
          'feature-with-dash': true,
          'feature_with_underscore': false,
          'feature.with.dot': true,
        },
        mockExternalAPIs: false,
        captureAllLogs: false,
      };

      const context = await orchestrator.setupTest(config);

      // Feature flags should be set despite special characters
      expect(context.metadata?.featureFlags).toEqual(config.featureFlags);

      await orchestrator.teardownTest(context);
    });
  });
});
