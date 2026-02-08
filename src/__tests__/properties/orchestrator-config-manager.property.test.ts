/**
 * Property-Based Tests: Config Manager
 * Properties 32-33 and 21
 */

import fc from 'fast-check';
import { ConfigManager } from '../../orchestrator/config-manager.js';
import { ExecutionMode } from '../../orchestrator/types.js';

describe('ConfigManager - Property Tests', () => {
  const modeArb = fc.constantFrom<ExecutionMode>(
    'SHADOW_ONLY',
    'ENGINE_A_PRIMARY',
    'ENGINE_B_PRIMARY',
    'SPLIT_CAPITAL'
  );
  const splitArb = fc.float({ min: 0, max: 1, noNaN: true });
  const versionArb = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((value) => value.trim().length > 0);

  test('Property 32: Dynamic configuration application', async () => {
    await fc.assert(
      fc.asyncProperty(modeArb, splitArb, versionArb, async (execution_mode, split_percentage, policy_version) => {
        const manager = new ConfigManager({
          execution_mode,
          split_percentage,
          policy_version,
        });
        const config = manager.getConfig();
        expect(config.execution_mode).toBe(execution_mode);
        expect(config.split_percentage).toBeCloseTo(split_percentage, 6);
        expect(config.policy_version).toBe(policy_version);
      }),
      { numRuns: 50 }
    );
  });

  test('Property 33: Split capital percentage application', async () => {
    await fc.assert(
      fc.asyncProperty(splitArb, async (split_percentage) => {
        const manager = new ConfigManager({
          execution_mode: 'SPLIT_CAPITAL',
          split_percentage,
          policy_version: 'v1.0',
        });
        const config = manager.getConfig();
        expect(config.execution_mode).toBe('SPLIT_CAPITAL');
        expect(config.split_percentage).toBeCloseTo(split_percentage, 6);
      }),
      { numRuns: 50 }
    );
  });

  test('Property 21: Policy version tracking', async () => {
    await fc.assert(
      fc.asyncProperty(versionArb, async (policy_version) => {
        const manager = new ConfigManager({
          execution_mode: 'SHADOW_ONLY',
          split_percentage: 0.5,
          policy_version,
        });
        const config = manager.getConfig();
        expect(config.policy_version).toBe(policy_version);
      }),
      { numRuns: 50 }
    );
  });
});
