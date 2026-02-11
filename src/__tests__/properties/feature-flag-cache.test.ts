/**
 * Property-Based Test: Feature flag cache refresh
 * Property 22: Master feature flag override (enable_variant_b) defaults false
 * Validates: Requirements 8.4, 13.6
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { featureFlags, FeatureFlagService } from '../../services/feature-flag.service.js';
import { db } from '../../services/database.service.js';

describe('Property 22: Feature flag cache refresh', () => {
  afterEach(() => {
    featureFlags.stop();
    (db.query as jest.Mock).mockClear();
  });

  const enabledArb = fc.boolean();

  test('Property: updateFlag refreshes cache for enable_variant_b', async () => {
    await fc.assert(
      fc.asyncProperty(enabledArb, async (enabled) => {
        const service = new FeatureFlagService();

        (db.query as jest.Mock).mockResolvedValueOnce({
          rows: [
            {
              flag_id: '1',
              name: 'enable_variant_b',
              enabled: false,
              description: 'Master switch',
              updated_at: new Date(),
              updated_by: null,
            },
          ],
        });

        await service.refreshCache();
        expect(service.isEnabled('enable_variant_b')).toBe(false);

        (db.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });
        (db.query as jest.Mock).mockResolvedValueOnce({
          rows: [
            {
              flag_id: '1',
              name: 'enable_variant_b',
              enabled,
              description: 'Master switch',
              updated_at: new Date(),
              updated_by: 'admin',
            },
          ],
        });

        const updated = await service.updateFlag('enable_variant_b', enabled, 'admin');
        expect(updated).toBe(true);
        expect(service.isEnabled('enable_variant_b')).toBe(enabled);
      }),
      { numRuns: 50 }
    );
  });
});
