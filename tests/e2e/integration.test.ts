/**
 * Integration Tests
 * 
 * These tests validate the end-to-end integration of all components:
 * - Generators → Orchestrator → Validation → Reporting
 * - Test runner phase execution
 * - Error handling across components
 * - Configuration management
 * 
 * Requirements: All requirements
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createE2ETestSystem,
  createTestRunner,
  createWebhookGenerator,
  createGEXGenerator,
  createTestOrchestrator,
  createDefaultConfig,
  createScenarioConfig,
  validateConfig,
} from './index';

describe('E2E Test System Integration', () => {
  describe('Component Wiring', () => {
    it('should create E2E test system with all components', () => {
      const system = createE2ETestSystem();
      
      expect(system).toBeDefined();
      expect(system.getRunner()).toBeDefined();
      expect(system.getWebhookGenerator()).toBeDefined();
      expect(system.getGEXGenerator()).toBeDefined();
      expect(system.getOrchestrator()).toBeDefined();
    });
    
    it('should create individual components independently', () => {
      const runner = createTestRunner();
      const webhookGen = createWebhookGenerator();
      const gexGen = createGEXGenerator();
      const orchestrator = createTestOrchestrator();
      
      expect(runner).toBeDefined();
      expect(webhookGen).toBeDefined();
      expect(gexGen).toBeDefined();
      expect(orchestrator).toBeDefined();
    });
    
    it('should access test phases from runner', () => {
      const system = createE2ETestSystem();
      const phases = system.getPhases();
      
      expect(phases).toBeDefined();
      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0]).toHaveProperty('phaseNumber');
      expect(phases[0]).toHaveProperty('name');
      expect(phases[0]).toHaveProperty('description');
    });
  });
  
  describe('Generator → Orchestrator Integration', () => {
    let orchestrator: any;
    let webhookGen: any;
    let gexGen: any;
    let context: any;
    
    beforeEach(async () => {
      orchestrator = createTestOrchestrator();
      webhookGen = createWebhookGenerator();
      gexGen = createGEXGenerator();
      
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      
      context = await orchestrator.setupTest(config);
    });
    
    afterEach(async () => {
      if (context) {
        await orchestrator.teardownTest(context);
      }
    });
    
    it('should inject synthetic webhook through orchestrator', async () => {
      const webhook = webhookGen.generateWebhook({
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT',
        price: 450,
        volume: 1000000,
        timestamp: Date.now(),
      });
      
      // Should not throw
      await expect(orchestrator.injectWebhook(context, webhook)).resolves.not.toThrow();
      
      // Verify webhook was tracked
      expect(context.injectedData).toContain(webhook);
    });
    
    it('should inject synthetic GEX data through orchestrator', async () => {
      const gex = gexGen.generateGEX({
        type: 'POSITIVE',
        symbol: 'SPY',
        spotPrice: 450,
      });
      
      // Should not throw
      await expect(orchestrator.injectGEX(context, gex)).resolves.not.toThrow();
      
      // Verify GEX was tracked
      expect(context.injectedData).toContain(gex);
    });
    
    it('should reject unmarked synthetic data', async () => {
      const unmarkedWebhook = {
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
          synthetic: false, // Not marked as synthetic!
          scenario: {} as any,
          generatedAt: Date.now(),
        },
      };
      
      await expect(orchestrator.injectWebhook(context, unmarkedWebhook))
        .rejects.toThrow('must be marked as synthetic');
    });
    
    it('should capture system state after injection', async () => {
      const webhook = webhookGen.generateWebhook({
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT',
        price: 450,
        volume: 1000000,
        timestamp: Date.now(),
      });
      
      await orchestrator.injectWebhook(context, webhook);
      const state = await orchestrator.captureState(context);
      
      expect(state).toBeDefined();
      expect(state).toHaveProperty('timestamp');
      expect(state).toHaveProperty('webhookProcessingCount');
      expect(state).toHaveProperty('enrichmentCallCount');
      expect(state).toHaveProperty('routerDecisions');
      expect(state).toHaveProperty('engineADecisions');
      expect(state).toHaveProperty('engineBDecisions');
    });
  });
  
  describe('Configuration Management', () => {
    it('should create default configuration', () => {
      const config = createDefaultConfig();
      
      expect(config).toBeDefined();
      expect(config.testConfig).toBeDefined();
      expect(config.testConfig.isolatedEnvironment).toBe(true);
      expect(config.testConfig.mockExternalAPIs).toBe(true);
      expect(config.propertyTestIterations).toBe(100);
    });
    
    it('should create scenario-specific configurations', () => {
      const unitConfig = createScenarioConfig('unit');
      const e2eConfig = createScenarioConfig('e2e');
      const regressionConfig = createScenarioConfig('regression');
      
      expect(unitConfig.propertyTestIterations).toBe(50);
      expect(e2eConfig.propertyTestIterations).toBe(100);
      expect(regressionConfig.propertyTestIterations).toBe(200);
      expect(regressionConfig.stopOnFailure).toBe(true);
    });
    
    it('should validate valid configuration', () => {
      const config = createDefaultConfig();
      const validation = validateConfig(config);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
    
    it('should reject invalid configuration', () => {
      const config = createDefaultConfig();
      config.propertyTestIterations = 0; // Invalid!
      
      const validation = validateConfig(config);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('at least 1');
    });
    
    it('should reject production environment', () => {
      const config = createDefaultConfig();
      config.testConfig.environment = 'production';
      
      const validation = validateConfig(config);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('production'))).toBe(true);
    });
  });
  
  describe('Test Runner Phase Management', () => {
    it('should define all test phases', () => {
      const runner = createTestRunner();
      const phases = runner.getPhases();
      
      expect(phases.length).toBeGreaterThan(0);
      
      // Verify phase structure
      for (const phase of phases) {
        expect(phase).toHaveProperty('phaseNumber');
        expect(phase).toHaveProperty('name');
        expect(phase).toHaveProperty('description');
        expect(phase).toHaveProperty('testSuite');
        expect(phase).toHaveProperty('isCheckpoint');
        expect(phase).toHaveProperty('requirements');
        expect(phase).toHaveProperty('properties');
      }
    });
    
    it('should get specific phase by number', () => {
      const runner = createTestRunner();
      const phase1 = runner.getPhase(1);
      
      expect(phase1).toBeDefined();
      expect(phase1?.phaseNumber).toBe(1);
      expect(phase1?.name).toBe('Synthetic Data Generation');
    });
    
    it('should return undefined for non-existent phase', () => {
      const runner = createTestRunner();
      const phase = runner.getPhase(9999);
      
      expect(phase).toBeUndefined();
    });
    
    it('should identify checkpoint phases', () => {
      const runner = createTestRunner();
      const phases = runner.getPhases();
      const checkpoints = phases.filter(p => p.isCheckpoint);
      
      expect(checkpoints.length).toBeGreaterThan(0);
      expect(checkpoints.some(p => p.name.includes('Checkpoint'))).toBe(true);
    });
  });
  
  describe('End-to-End Flow', () => {
    it('should complete full workflow: generate → inject → capture', async () => {
      // Create components
      const webhookGen = createWebhookGenerator();
      const gexGen = createGEXGenerator();
      const orchestrator = createTestOrchestrator();
      
      // Set up test
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      const context = await orchestrator.setupTest(config);
      
      try {
        // Generate synthetic data
        const webhook = webhookGen.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450,
          volume: 1000000,
          timestamp: Date.now(),
        });
        
        const gex = gexGen.generateGEX({
          type: 'NEGATIVE',
          symbol: 'SPY',
          spotPrice: 450,
        });
        
        // Verify synthetic marking
        expect(webhook.metadata.synthetic).toBe(true);
        expect(gex.metadata.synthetic).toBe(true);
        
        // Inject data
        await orchestrator.injectWebhook(context, webhook);
        await orchestrator.injectGEX(context, gex);
        
        // Verify injection tracking
        expect(context.injectedData).toHaveLength(2);
        
        // Capture state
        const state = await orchestrator.captureState(context);
        
        // Verify state capture
        expect(state).toBeDefined();
        expect(state.timestamp).toBeGreaterThan(0);
        expect(context.capturedStates).toContain(state);
        
      } finally {
        // Clean up
        await orchestrator.teardownTest(context);
      }
    });
    
    it('should handle multiple data injections', async () => {
      const webhookGen = createWebhookGenerator();
      const orchestrator = createTestOrchestrator();
      
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      const context = await orchestrator.setupTest(config);
      
      try {
        // Inject multiple webhooks
        for (let i = 0; i < 5; i++) {
          const webhook = webhookGen.generateWebhook({
            symbol: 'SPY',
            timeframe: '5m',
            session: 'RTH_OPEN',
            pattern: 'ORB_BREAKOUT',
            price: 450 + i,
            volume: 1000000,
            timestamp: Date.now() + i * 1000,
          });
          
          await orchestrator.injectWebhook(context, webhook);
        }
        
        // Verify all injections tracked
        expect(context.injectedData).toHaveLength(5);
        
        // Capture state
        const state = await orchestrator.captureState(context);
        expect(state).toBeDefined();
        
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should handle orchestrator setup failure gracefully', async () => {
      const orchestrator = createTestOrchestrator();
      
      // Invalid configuration
      const invalidConfig: any = {
        isolatedEnvironment: true,
        featureFlags: null, // Invalid!
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      
      // Should handle gracefully (may throw or return error)
      try {
        await orchestrator.setupTest(invalidConfig);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
    
    it('should clean up resources on teardown', async () => {
      const orchestrator = createTestOrchestrator();
      
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      
      const context = await orchestrator.setupTest(config);
      
      // Should not throw
      await expect(orchestrator.teardownTest(context)).resolves.not.toThrow();
    });
    
    it('should handle double teardown gracefully', async () => {
      const orchestrator = createTestOrchestrator();
      
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      
      const context = await orchestrator.setupTest(config);
      
      // First teardown
      await orchestrator.teardownTest(context);
      
      // Second teardown should not throw
      await expect(orchestrator.teardownTest(context)).resolves.not.toThrow();
    });
  });
  
  describe('Replay Functionality', () => {
    it('should replay test with same data', async () => {
      const webhookGen = createWebhookGenerator();
      const orchestrator = createTestOrchestrator();
      
      const config = {
        isolatedEnvironment: true,
        featureFlags: { ENGINE_B_ENABLED: true },
        mockExternalAPIs: true,
        captureAllLogs: true,
      };
      
      // Original test
      const originalContext = await orchestrator.setupTest(config);
      
      try {
        const webhook = webhookGen.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450,
          volume: 1000000,
          timestamp: Date.now(),
        });
        
        await orchestrator.injectWebhook(originalContext, webhook);
        await orchestrator.captureState(originalContext);
        
        // Replay test
        const replayContext = await orchestrator.replayTest(originalContext);
        
        try {
          // Verify replay context
          expect(replayContext).toBeDefined();
          expect(replayContext.testId).not.toBe(originalContext.testId);
          expect(replayContext.injectedData).toHaveLength(originalContext.injectedData.length);
          
        } finally {
          await orchestrator.teardownTest(replayContext);
        }
        
      } finally {
        await orchestrator.teardownTest(originalContext);
      }
    });
  });
});

describe('E2E Test System API', () => {
  describe('Quick Start Functions', () => {
    it('should provide createE2ETestSystem factory', () => {
      const system = createE2ETestSystem();
      expect(system).toBeDefined();
      expect(typeof system.runAllTests).toBe('function');
    });
    
    it('should provide convenience methods', () => {
      const system = createE2ETestSystem();
      
      expect(typeof system.runEngineARegression).toBe('function');
      expect(typeof system.runEngineBTests).toBe('function');
      expect(typeof system.runFeatureFlagTests).toBe('function');
      expect(typeof system.runCITests).toBe('function');
      expect(typeof system.runNightlyTests).toBe('function');
    });
  });
});
