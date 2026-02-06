/**
 * Tests for validation framework configuration
 */

import { defaultValidationConfig, getValidationConfig } from '../config.js';
import { ValidationCategory } from '../types/index.js';

describe('Validation Configuration', () => {
  describe('defaultValidationConfig', () => {
    it('should have minimum readiness score of 95', () => {
      expect(defaultValidationConfig.minReadinessScore).toBe(95);
    });

    it('should have 100 property test iterations', () => {
      expect(defaultValidationConfig.propertyTestIterations).toBe(100);
    });

    it('should have weights for all validation categories', () => {
      const categories = Object.values(ValidationCategory);
      
      categories.forEach(category => {
        expect(defaultValidationConfig.categoryWeights.has(category)).toBe(true);
        const weight = defaultValidationConfig.categoryWeights.get(category);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(10);
      });
    });

    it('should have criticality levels for all validation categories', () => {
      const categories = Object.values(ValidationCategory);
      
      categories.forEach(category => {
        expect(defaultValidationConfig.categoryCriticality.has(category)).toBe(true);
        const criticality = defaultValidationConfig.categoryCriticality.get(category);
        expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(criticality);
      });
    });

    it('should mark critical categories with highest weights', () => {
      const criticalCategories = [
        ValidationCategory.WEBHOOK_INFRASTRUCTURE,
        ValidationCategory.SIGNAL_PROCESSING,
        ValidationCategory.SIGNAL_DELIVERY,
        ValidationCategory.ACCESS_CONTROL,
        ValidationCategory.END_TO_END,
        ValidationCategory.KILL_SWITCHES,
      ];

      criticalCategories.forEach(category => {
        const weight = defaultValidationConfig.categoryWeights.get(category);
        expect(weight).toBeGreaterThanOrEqual(9);
      });
    });

    it('should enable parallel execution by default', () => {
      expect(defaultValidationConfig.enableParallelExecution).toBe(true);
    });

    it('should have reasonable timeout values', () => {
      expect(defaultValidationConfig.validationTimeout).toBe(30000); // 30 seconds
      expect(defaultValidationConfig.suiteTimeout).toBe(300000); // 5 minutes
    });
  });

  describe('getValidationConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should return default config when no env vars are set', () => {
      const config = getValidationConfig();
      
      expect(config.minReadinessScore).toBe(95);
      expect(config.propertyTestIterations).toBe(100);
      expect(config.enableParallelExecution).toBe(true);
    });

    it('should override minReadinessScore from env var', () => {
      process.env.MIN_READINESS_SCORE = '90';
      const config = getValidationConfig();
      
      expect(config.minReadinessScore).toBe(90);
    });

    it('should override propertyTestIterations from env var', () => {
      process.env.PROPERTY_TEST_ITERATIONS = '200';
      const config = getValidationConfig();
      
      expect(config.propertyTestIterations).toBe(200);
    });

    it('should override validationTimeout from env var', () => {
      process.env.VALIDATION_TIMEOUT = '60000';
      const config = getValidationConfig();
      
      expect(config.validationTimeout).toBe(60000);
    });

    it('should disable parallel execution from env var', () => {
      process.env.ENABLE_PARALLEL_VALIDATION = 'false';
      const config = getValidationConfig();
      
      expect(config.enableParallelExecution).toBe(false);
    });

    it('should override maxConcurrentValidations from env var', () => {
      process.env.MAX_CONCURRENT_VALIDATIONS = '8';
      const config = getValidationConfig();
      
      expect(config.maxConcurrentValidations).toBe(8);
    });
  });
});
