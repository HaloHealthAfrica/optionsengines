/**
 * User Profile Generator for Validation Framework
 * 
 * Generates synthetic user profiles with different subscription tiers,
 * usage patterns, and engine assignments for validation testing.
 */

import crypto from 'crypto';
import { UserProfile, SubscriptionTier } from '../types/index.js';

/**
 * Subscription tier quotas
 */
const TIER_QUOTAS = {
  FREE: 10,
  BASIC: 50,
  PREMIUM: 200,
  ENTERPRISE: 1000,
};

/**
 * User Profile Generator
 * 
 * Creates realistic user profiles for validation testing.
 */
export class UserProfileGenerator {
  /**
   * Generate a user profile
   * 
   * @param tier - Subscription tier
   * @returns Generated user profile
   */
  generateUser(tier: SubscriptionTier): UserProfile {
    const userId = this.generateUserId();
    const signalQuota = TIER_QUOTAS[tier];
    const signalsUsed = this.randomUsage(signalQuota);
    const engineAssignment = this.randomEngineAssignment();

    return {
      userId,
      subscriptionTier: tier,
      signalQuota,
      signalsUsed,
      engineAssignment,
      active: true,
    };
  }

  /**
   * Generate a batch of user profiles
   * 
   * @param tiers - Array of subscription tiers
   * @returns Array of generated user profiles
   */
  generateBatch(tiers: SubscriptionTier[]): UserProfile[] {
    return tiers.map(tier => this.generateUser(tier));
  }

  /**
   * Generate a user with specific usage
   * 
   * @param tier - Subscription tier
   * @param signalsUsed - Number of signals used
   * @returns User profile with specific usage
   */
  generateWithUsage(tier: SubscriptionTier, signalsUsed: number): UserProfile {
    const user = this.generateUser(tier);
    user.signalsUsed = signalsUsed;
    return user;
  }

  /**
   * Generate a user at quota limit
   * 
   * @param tier - Subscription tier
   * @returns User profile at quota limit
   */
  generateAtQuotaLimit(tier: SubscriptionTier): UserProfile {
    const user = this.generateUser(tier);
    user.signalsUsed = user.signalQuota;
    return user;
  }

  /**
   * Generate a user over quota limit
   * 
   * @param tier - Subscription tier
   * @returns User profile over quota limit
   */
  generateOverQuotaLimit(tier: SubscriptionTier): UserProfile {
    const user = this.generateUser(tier);
    user.signalsUsed = user.signalQuota + Math.floor(Math.random() * 10) + 1;
    return user;
  }

  /**
   * Generate an inactive user
   * 
   * @param tier - Subscription tier
   * @returns Inactive user profile
   */
  generateInactiveUser(tier: SubscriptionTier): UserProfile {
    const user = this.generateUser(tier);
    user.active = false;
    return user;
  }

  /**
   * Generate a user assigned to Engine A
   * 
   * @param tier - Subscription tier
   * @returns User profile assigned to Engine A
   */
  generateEngineAUser(tier: SubscriptionTier): UserProfile {
    const user = this.generateUser(tier);
    user.engineAssignment = 'A';
    return user;
  }

  /**
   * Generate a user assigned to Engine B
   * 
   * @param tier - Subscription tier
   * @returns User profile assigned to Engine B
   */
  generateEngineBUser(tier: SubscriptionTier): UserProfile {
    const user = this.generateUser(tier);
    user.engineAssignment = 'B';
    return user;
  }

  /**
   * Generate users across all tiers
   * 
   * @returns Array of users, one per tier
   */
  generateAllTiers(): UserProfile[] {
    const tiers: SubscriptionTier[] = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'];
    return this.generateBatch(tiers);
  }

  /**
   * Generate a diverse set of users with various usage patterns
   * 
   * @param count - Number of users to generate
   * @returns Array of diverse user profiles
   */
  generateDiverseUsers(count: number): UserProfile[] {
    const users: UserProfile[] = [];
    const tiers: SubscriptionTier[] = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'];

    for (let i = 0; i < count; i++) {
      const tier = tiers[i % tiers.length];
      const usagePattern = i % 4;

      switch (usagePattern) {
        case 0:
          // Low usage
          users.push(this.generateWithUsage(tier, Math.floor(TIER_QUOTAS[tier] * 0.2)));
          break;
        case 1:
          // Medium usage
          users.push(this.generateWithUsage(tier, Math.floor(TIER_QUOTAS[tier] * 0.5)));
          break;
        case 2:
          // High usage
          users.push(this.generateWithUsage(tier, Math.floor(TIER_QUOTAS[tier] * 0.9)));
          break;
        case 3:
          // At limit
          users.push(this.generateAtQuotaLimit(tier));
          break;
      }
    }

    return users;
  }

  /**
   * Generate a unique user ID
   * 
   * @returns User ID
   */
  private generateUserId(): string {
    return `user_${crypto.randomUUID()}`;
  }

  /**
   * Generate random usage within quota
   * 
   * @param quota - Signal quota
   * @returns Random usage amount
   */
  private randomUsage(quota: number): number {
    return Math.floor(Math.random() * quota);
  }

  /**
   * Randomly assign engine (A or B)
   * 
   * @returns Engine assignment
   */
  private randomEngineAssignment(): 'A' | 'B' {
    return Math.random() < 0.5 ? 'A' : 'B';
  }
}

/**
 * Default user profile generator instance
 */
export const userProfileGenerator = new UserProfileGenerator();
