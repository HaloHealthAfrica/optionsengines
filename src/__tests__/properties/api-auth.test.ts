/**
 * Property-Based Test: API response format
 * Property 43: Token-based authentication
 * Validates: Requirements 20.1, 20.6
 */

import fc from 'fast-check';
import { Router } from 'express';
import engine2Routes from '../../routes/engine2.js';
import { authService } from '../../services/auth.service.js';
import { db } from '../../services/database.service.js';

jest.mock('../../services/auth.service.js', () => ({
  authService: {
    extractTokenFromHeader: jest.fn(),
    verifyToken: jest.fn(),
  },
}));

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
  statusCode?: number;
  body?: any;
};

function createRes(resolve: (res: MockResponse) => void): MockResponse {
  const res: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation((body: any) => {
      res.body = body;
      resolve(res);
      return res;
    }),
  };
  return res;
}

function runRoute(router: Router, req: any): Promise<MockResponse> {
  return new Promise((resolve, reject) => {
    const res = createRes(resolve);
    (router as any).handle(req, res as any, (err: any) =>
      err ? reject(err) : resolve(res)
    );
  });
}

describe('Property 43: token-based auth for API endpoints', () => {
  const router = engine2Routes;

  afterEach(() => {
    (authService.extractTokenFromHeader as jest.Mock).mockReset();
    (authService.verifyToken as jest.Mock).mockReset();
    (db.query as jest.Mock).mockReset();
  });

  test('requires token for /experiments', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (hasToken) => {
        (authService.extractTokenFromHeader as jest.Mock).mockReturnValue(
          hasToken ? 'token' : null
        );
        (authService.verifyToken as jest.Mock).mockReturnValue(
          hasToken ? { userId: 'u1', email: 'x@y.com', role: 'user' } : null
        );
        (db.query as jest.Mock).mockResolvedValue({ rows: [] });

        const req = {
          method: 'GET',
          url: '/experiments',
          headers: hasToken ? { authorization: 'Bearer token' } : {},
          query: {},
        };

        const res = await runRoute(router, req);
        if (hasToken) {
          expect(res.status).not.toHaveBeenCalledWith(401);
          expect(res.body).toEqual({ data: [] });
        } else {
          expect(res.status).toHaveBeenCalledWith(401);
        }
      }),
      { numRuns: 30 }
    );
  });
});
