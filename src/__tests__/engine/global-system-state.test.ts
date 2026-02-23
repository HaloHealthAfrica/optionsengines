import { SystemState, SystemStateTransitionTrigger } from '../../engine/types/enums';
import { SystemNotActiveError } from '../../engine/types/errors';

// Mock dependencies
const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../services/database.service', () => ({
  db: {
    query: (...args: any[]) => mockQuery(...args),
    transaction: (cb: Function) => mockTransaction(cb),
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

import { GlobalSystemStateController } from '../../engine/core/GlobalSystemStateController';

describe('GlobalSystemStateController', () => {
  let controller: GlobalSystemStateController;

  beforeEach(() => {
    controller = new GlobalSystemStateController();
    controller.invalidateCache();
    mockQuery.mockReset();
    mockTransaction.mockReset();
  });

  describe('getCurrentState', () => {
    test('returns ACTIVE when database has ACTIVE state', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });
      const state = await controller.getCurrentState();
      expect(state).toBe(SystemState.ACTIVE);
    });

    test('returns EMERGENCY_STOP when no record found (fail-closed)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const state = await controller.getCurrentState();
      expect(state).toBe(SystemState.EMERGENCY_STOP);
    });

    test('returns EMERGENCY_STOP on database error (fail-closed)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
      const state = await controller.getCurrentState();
      expect(state).toBe(SystemState.EMERGENCY_STOP);
    });

    test('caches state for 1 second', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });

      await controller.getCurrentState();
      await controller.getCurrentState();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('check', () => {
    test('returns ACTIVE when state is ACTIVE', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });
      const state = await controller.check();
      expect(state).toBe(SystemState.ACTIVE);
    });

    test('throws SystemNotActiveError when state is PAUSED', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'PAUSED' }] });
      await expect(controller.check()).rejects.toThrow(SystemNotActiveError);
    });

    test('throws SystemNotActiveError when state is EMERGENCY_STOP', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'EMERGENCY_STOP' }] });
      await expect(controller.check()).rejects.toThrow(SystemNotActiveError);
    });
  });

  describe('transition', () => {
    test('transitions ACTIVE → PAUSED', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });

      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const result = await controller.transition(
        SystemState.PAUSED,
        SystemStateTransitionTrigger.BROKER_SYNC_FREEZE,
        'test',
        'test reason'
      );

      expect(result).toBe(SystemState.PAUSED);
      expect(mockClient.query).toHaveBeenCalledTimes(2); // UPDATE + INSERT log
    });

    test('rejects illegal transition PAUSED → PAUSED (no-op)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'PAUSED' }] });

      const result = await controller.transition(
        SystemState.PAUSED,
        SystemStateTransitionTrigger.MANUAL,
        'test',
        'test'
      );

      expect(result).toBe(SystemState.PAUSED);
    });

    test('rejects ACTIVE → ACTIVE (no-op)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });

      const result = await controller.transition(
        SystemState.ACTIVE,
        SystemStateTransitionTrigger.MANUAL,
        'test',
        'test'
      );

      expect(result).toBe(SystemState.ACTIVE);
    });

    test('rejects EMERGENCY_STOP → ACTIVE from non-manual trigger', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'EMERGENCY_STOP' }] });

      await expect(
        controller.transition(
          SystemState.ACTIVE,
          SystemStateTransitionTrigger.BROKER_SYNC_FREEZE,
          'automated',
          'auto resume attempt'
        )
      ).rejects.toThrow('EMERGENCY_STOP can only be resolved manually');
    });

    test('allows EMERGENCY_STOP → ACTIVE from manual trigger', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'EMERGENCY_STOP' }] });

      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const result = await controller.transition(
        SystemState.ACTIVE,
        SystemStateTransitionTrigger.MANUAL,
        'admin',
        'manual resolution'
      );

      expect(result).toBe(SystemState.ACTIVE);
    });

    test('rejects illegal transitions (ACTIVE → invalid)', async () => {
      // ACTIVE can only go to PAUSED or EMERGENCY_STOP
      // So there's no truly illegal transition from ACTIVE except to itself (no-op)
      // Test PAUSED → EMERGENCY_STOP (valid) then EMERGENCY_STOP → PAUSED (invalid)
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'EMERGENCY_STOP' }] });

      await expect(
        controller.transition(
          SystemState.PAUSED,
          SystemStateTransitionTrigger.MANUAL,
          'test',
          'test'
        )
      ).rejects.toThrow('Illegal system state transition');
    });
  });

  describe('isActive', () => {
    test('returns true when ACTIVE', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'ACTIVE' }] });
      expect(await controller.isActive()).toBe(true);
    });

    test('returns false when PAUSED', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ state: 'PAUSED' }] });
      expect(await controller.isActive()).toBe(false);
    });
  });
});
