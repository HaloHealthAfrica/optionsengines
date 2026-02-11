import { Router } from 'express';
import featureFlagRoutes from '../routes/feature-flags.js';
import { featureFlags } from '../services/feature-flag.service.js';
import { authService } from '../services/auth.service.js';

jest.mock('../services/feature-flag.service.js', () => ({
  featureFlags: {
    updateFlag: jest.fn(),
  },
}));

jest.mock('../services/auth.service.js', () => ({
  authService: {
    extractTokenFromHeader: jest.fn(),
    verifyToken: jest.fn(),
  },
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

describe('POST /feature-flags', () => {
  const router = featureFlagRoutes;

  test('returns 403 for non-admin', async () => {
    (authService.extractTokenFromHeader as jest.Mock).mockReturnValue('token');
    (authService.verifyToken as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'test@example.com',
      role: 'user',
    });

    const req = {
      method: 'POST',
      url: '/',
      headers: { authorization: 'Bearer token' },
      body: { name: 'enable_variant_b', enabled: true },
    };

    const res = await runRoute(router, req);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  test('returns 404 when flag not found', async () => {
    (authService.extractTokenFromHeader as jest.Mock).mockReturnValue('token');
    (authService.verifyToken as jest.Mock).mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
    });
    (featureFlags.updateFlag as jest.Mock).mockResolvedValue(false);

    const req = {
      method: 'POST',
      url: '/',
      headers: { authorization: 'Bearer token' },
      body: { name: 'enable_variant_b', enabled: true },
    };

    const res = await runRoute(router, req);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.body).toEqual({ error: 'Flag not found' });
  });
});
