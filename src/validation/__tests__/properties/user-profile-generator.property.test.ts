/**
 * Property-based tests for User Profile Generator
 * 
 * Feature: gtm-launch-readiness-validation
 * Property 58: Synthetic User Profile Diversity
 * Validates: Requirements 11.4
 */

import * as fc from 'fast-check';
import { UserProfileGenerator } from '../../generators/user-profile-generator.js';
import { SubscriptionTier } from '../../types/index.js';
import { PROPERTY_TEST_ITERATIONS } from '../setup.js';

describe('User Profile Generator Property Tests', () => {
  let generator: UserProfileGenerator;

  beforeEach(() => {
    generator = new UserProfileGenerator();
  });

  describe('Property 58: Synthetic User Profile Diversity', () => {
    // Feature: gtm-launch-readiness-validation, Property 58: Synthetic User Profile Diversity
    
    it('should generate valid user profile with all required fields', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateUser(tier);

            // Verify all required fields are present
            expect(user).toBeDefined();
            expect(user.userId).toBeDefined();
            expect(typeof user.userId).toBe('string');
            expect(user.userId.startsWith('user_')).toBe(true);
            expect(user.subscriptionTier).toBe(tier);
            expect(typeof user.signalQuota).toBe('number');
            expect(typeof user.signalsUsed).toBe('number');
            expect(['A', 'B']).toContain(user.engineAssignment);
            expect(typeof user.active).toBe('boolean');

            // Verify usage is within quota
            expect(user.signalsUsed).toBeGreaterThanOrEqual(0);
            expect(user.signalsUsed).toBeLessThanOrEqual(user.signalQuota);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should assign correct quotas for each tier', () => {
      const tierQuotas = {
        FREE: 10,
        BASIC: 50,
        PREMIUM: 200,
        ENTERPRISE: 1000,
      };

      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateUser(tier);

            expect(user.signalQuota).toBe(tierQuotas[tier]);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate unique user IDs', () => {
      const userIds = new Set<string>();
      const count = PROPERTY_TEST_ITERATIONS;

      for (let i = 0; i < count; i++) {
        const user = generator.generateUser('BASIC');
        userIds.add(user.userId);
      }

      // All user IDs should be unique
      expect(userIds.size).toBe(count);
    });

    it('should generate users with specific usage correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          fc.integer({ min: 0, max: 1000 }),
          (tier: SubscriptionTier, signalsUsed: number) => {
            const user = generator.generateWithUsage(tier, signalsUsed);

            expect(user.signalsUsed).toBe(signalsUsed);
            expect(user.subscriptionTier).toBe(tier);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate users at quota limit correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateAtQuotaLimit(tier);

            expect(user.signalsUsed).toBe(user.signalQuota);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate users over quota limit correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateOverQuotaLimit(tier);

            expect(user.signalsUsed).toBeGreaterThan(user.signalQuota);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate inactive users correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateInactiveUser(tier);

            expect(user.active).toBe(false);
            expect(user.subscriptionTier).toBe(tier);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate Engine A users correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateEngineAUser(tier);

            expect(user.engineAssignment).toBe('A');
            expect(user.subscriptionTier).toBe(tier);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate Engine B users correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateEngineBUser(tier);

            expect(user.engineAssignment).toBe('B');
            expect(user.subscriptionTier).toBe(tier);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate all tiers correctly', () => {
      const users = generator.generateAllTiers();

      expect(users).toHaveLength(4);
      
      const tiers = users.map(u => u.subscriptionTier);
      expect(tiers).toContain('FREE');
      expect(tiers).toContain('BASIC');
      expect(tiers).toContain('PREMIUM');
      expect(tiers).toContain('ENTERPRISE');
    });

    it('should generate diverse users with various usage patterns', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 4, max: 20 }),
          (count: number) => {
            const users = generator.generateDiverseUsers(count);

            expect(users).toHaveLength(count);

            // Verify diversity in usage patterns
            const usagePatterns = users.map(u => {
              const usagePercent = u.signalsUsed / u.signalQuota;
              if (usagePercent < 0.3) return 'low';
              if (usagePercent < 0.7) return 'medium';
              if (usagePercent < 1.0) return 'high';
              return 'at-limit';
            });

            // Should have at least 2 different usage patterns
            const uniquePatterns = new Set(usagePatterns);
            expect(uniquePatterns.size).toBeGreaterThanOrEqual(2);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate batch of users with consistent structure', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
            { minLength: 1, maxLength: 10 }
          ),
          (tiers: SubscriptionTier[]) => {
            const users = generator.generateBatch(tiers);

            // Should generate same number of users as tiers
            expect(users.length).toBe(tiers.length);

            // All users should have valid structure
            users.forEach((user, index) => {
              expect(user.subscriptionTier).toBe(tiers[index]);
              expect(user.userId).toBeDefined();
              expect(user.signalsUsed).toBeLessThanOrEqual(user.signalQuota);
              expect(['A', 'B']).toContain(user.engineAssignment);
            });
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should distribute engine assignments roughly evenly', () => {
      const users = [];
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        users.push(generator.generateUser('BASIC'));
      }

      const engineACounts = users.filter(u => u.engineAssignment === 'A').length;

      // With random assignment, expect roughly 50/50 distribution (within 30% tolerance)
      const ratio = engineACounts / users.length;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.7);
    });

    it('should generate active users by default', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'),
          (tier: SubscriptionTier) => {
            const user = generator.generateUser(tier);

            expect(user.active).toBe(true);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });
  });
});
