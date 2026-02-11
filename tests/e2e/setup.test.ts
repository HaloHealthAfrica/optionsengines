/**
 * E2E Test Setup Verification
 * 
 * This test file verifies that the E2E test environment is properly configured.
 */

import { defaultE2EConfig, engineBDisabledConfig, determinismTestConfig } from './test-config';
import { assertSyntheticDataMarked, createSafeTestContext } from './setup';

describe('E2E Test Setup', () => {
  describe('Test Configuration', () => {
    it('should have default E2E config with correct settings', () => {
      expect(defaultE2EConfig.isolatedEnvironment).toBe(true);
      expect(defaultE2EConfig.mockExternalAPIs).toBe(true);
      expect(defaultE2EConfig.captureAllLogs).toBe(true);
      expect(defaultE2EConfig.propertyTesting.numRuns).toBeGreaterThanOrEqual(100);
      expect(defaultE2EConfig.isolation.preventLiveBrokerCalls).toBe(true);
    });

    it('should have Engine B disabled config with correct feature flags', () => {
      expect(engineBDisabledConfig.featureFlags.enableEngineB).toBe(false);
      expect(engineBDisabledConfig.featureFlags.enableMultiAgent).toBe(false);
      expect(engineBDisabledConfig.featureFlags.enableShadowExecution).toBe(false);
    });

    it('should have determinism test config with fixed seed', () => {
      expect(determinismTestConfig.propertyTesting.seed).toBeDefined();
      expect(determinismTestConfig.propertyTesting.numRuns).toBe(3);
      expect(determinismTestConfig.propertyTesting.enableShrinking).toBe(false);
    });
  });

  describe('Safety Checks', () => {
    it('should detect unmarked synthetic data', () => {
      const unmarkedData = {
        payload: { symbol: 'SPY' },
        metadata: { synthetic: false },
      };

      expect(() => assertSyntheticDataMarked(unmarkedData)).toThrow(
        'Safety violation: Data is not marked as synthetic'
      );
    });

    it('should accept properly marked synthetic data', () => {
      const markedData = {
        payload: { symbol: 'SPY' },
        metadata: { synthetic: true },
      };

      expect(() => assertSyntheticDataMarked(markedData)).not.toThrow();
    });

    it('should detect missing metadata', () => {
      const dataWithoutMetadata = {
        payload: { symbol: 'SPY' },
      };

      expect(() => assertSyntheticDataMarked(dataWithoutMetadata)).toThrow(
        'Safety violation: Data is not marked as synthetic'
      );
    });
  });

  describe('Safe Test Context', () => {
    it('should create a safe test context', () => {
      const context = createSafeTestContext();

      expect(context.brokerCallCount).toBe(0);
      expect(context.productionDataModified).toBe(false);
      expect(context.productionConfigModified).toBe(false);
    });

    it('should throw on broker call attempt', () => {
      const context = createSafeTestContext();

      expect(() => context.recordBrokerCall()).toThrow(
        'CRITICAL SAFETY VIOLATION: Live broker API call detected'
      );
    });

    it('should throw on production data modification attempt', () => {
      const context = createSafeTestContext();

      expect(() => context.recordProductionDataModification()).toThrow(
        'CRITICAL SAFETY VIOLATION: Production data modification detected'
      );
    });

    it('should throw on production config modification attempt', () => {
      const context = createSafeTestContext();

      expect(() => context.recordProductionConfigModification()).toThrow(
        'CRITICAL SAFETY VIOLATION: Production config modification detected'
      );
    });

    it('should pass safety assertion when no violations', () => {
      const context = createSafeTestContext();

      expect(() => context.assertSafe()).not.toThrow();
    });
  });

  describe('Test Environment', () => {
    it('should be running in test mode', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('should have Jest available', () => {
      expect(typeof describe).toBe('function');
      expect(typeof it).toBe('function');
      expect(typeof expect).toBe('function');
    });
  });
});
