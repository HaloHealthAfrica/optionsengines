/**
 * Property-Based Test: JWT token issuance
 * Property 42: Tokens issued for valid credentials are verifiable
 * Validates: Requirements 20.2
 */

import fc from 'fast-check';
import { authService } from '../../services/auth.service.js';

describe('Property 42: JWT token issuance', () => {
  const userIdArb = fc.string({ minLength: 1, maxLength: 32 });
  const emailArb = fc.string({ minLength: 3, maxLength: 40 });
  const roleArb = fc.constantFrom<'admin' | 'researcher' | 'user'>('admin', 'researcher', 'user');

  test('Property: generated tokens verify to same payload', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, emailArb, roleArb, async (userId, email, role) => {
        const tokenResult = authService.generateToken({ userId, email, role });
        expect(typeof tokenResult.token).toBe('string');

        const verified = authService.verifyToken(tokenResult.token);
        expect(verified).not.toBeNull();
        expect(verified?.userId).toBe(userId);
        expect(verified?.email).toBe(email);
        expect(verified?.role).toBe(role);
      }),
      { numRuns: 100 }
    );
  });
});
