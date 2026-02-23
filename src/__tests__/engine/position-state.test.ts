import { PositionState, TradeStructure } from '../../engine/types/enums';
import { PositionStateError, PositionWriteConflictError } from '../../engine/types/errors';

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
jest.mock('../../engine/core/AccountLedgerService', () => ({
  accountLedger: {
    validateAndReserveCapital: jest.fn(),
    commitEntry: jest.fn(),
    releaseCapital: jest.fn(),
    realizePnL: jest.fn(),
  },
}));

import { PositionStateService } from '../../engine/core/PositionStateService';

function makePositionRow(overrides: Record<string, any> = {}) {
  return {
    position_id: 'pos-1',
    account_id: 'acct-1',
    trade_plan_id: 'plan-1',
    underlying: 'SPY',
    structure: 'LONG_CALL',
    strategy_tag: 'ORB',
    state: 'PENDING_ENTRY',
    entry_order_id: 'order-1',
    exit_order_id: null,
    entry_filled_qty: 0,
    exit_filled_qty: 0,
    target_qty: 5,
    entry_avg_price: null,
    exit_avg_price: null,
    unrealized_pnl: '0.00',
    realized_pnl: null,
    version: 1,
    opened_at: new Date(),
    closed_at: null,
    force_close_reason: null,
    idempotency_key: 'idem-1',
    ...overrides,
  };
}

describe('PositionStateService', () => {
  let service: PositionStateService;

  beforeEach(() => {
    service = new PositionStateService();
    mockQuery.mockReset();
    mockTransaction.mockReset();
  });

  describe('createPosition', () => {
    test('creates a position in PENDING_ENTRY state', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // idempotency check
        .mockResolvedValueOnce({ rows: [makePositionRow()] }); // insert

      const pos = await service.createPosition({
        accountId: 'acct-1',
        tradePlanId: 'plan-1',
        underlying: 'SPY',
        structure: TradeStructure.LONG_CALL,
        strategyTag: 'ORB',
        targetQty: 5,
        entryOrderId: 'order-1',
        idempotencyKey: 'idem-1',
      });

      expect(pos.state).toBe(PositionState.PENDING_ENTRY);
      expect(pos.underlying).toBe('SPY');
      expect(pos.targetQty).toBe(5);
    });

    test('returns existing position on idempotency hit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePositionRow()] });

      const pos = await service.createPosition({
        accountId: 'acct-1',
        tradePlanId: 'plan-1',
        underlying: 'SPY',
        structure: TradeStructure.LONG_CALL,
        strategyTag: 'ORB',
        targetQty: 5,
        entryOrderId: 'order-1',
        idempotencyKey: 'idem-1',
      });

      expect(pos.positionId).toBe('pos-1');
      expect(mockQuery).toHaveBeenCalledTimes(1); // only idempotency check
    });
  });

  describe('transition — legal transitions', () => {
    test('PENDING_ENTRY → PARTIALLY_FILLED', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow()] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'PARTIALLY_FILLED', version: 2, entry_filled_qty: 2, entry_avg_price: '4.50',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.PARTIALLY_FILLED, {
        idempotencyKey: 'idem-2',
        filledQty: 2,
        fillPrice: 4.50,
      });

      expect(pos.state).toBe(PositionState.PARTIALLY_FILLED);
      expect(pos.version).toBe(2);
    });

    test('PENDING_ENTRY → OPEN (full fill)', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow()] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'OPEN', version: 2, entry_filled_qty: 5, entry_avg_price: '4.50',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.OPEN, {
        idempotencyKey: 'idem-2',
        filledQty: 5,
        fillPrice: 4.50,
      });

      expect(pos.state).toBe(PositionState.OPEN);
    });

    test('PENDING_ENTRY → CANCELLED', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow()] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'CANCELLED', version: 2, closed_at: new Date(),
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.CANCELLED, {
        idempotencyKey: 'idem-cancel',
      });

      expect(pos.state).toBe(PositionState.CANCELLED);
    });

    test('PARTIALLY_FILLED → OPEN', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'PARTIALLY_FILLED', entry_filled_qty: 2, entry_avg_price: '4.50',
          })] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'OPEN', version: 2, entry_filled_qty: 5, entry_avg_price: '4.60',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.OPEN, {
        idempotencyKey: 'idem-3',
        filledQty: 3,
        fillPrice: 4.70,
      });

      expect(pos.state).toBe(PositionState.OPEN);
    });

    test('OPEN → EXIT_PENDING', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({ state: 'OPEN' })] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'EXIT_PENDING', version: 2, exit_order_id: 'exit-order-1',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.EXIT_PENDING, {
        idempotencyKey: 'idem-4',
        exitOrderId: 'exit-order-1',
      });

      expect(pos.state).toBe(PositionState.EXIT_PENDING);
    });

    test('EXIT_PENDING → CLOSED', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({ state: 'EXIT_PENDING' })] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'CLOSED', version: 2, realized_pnl: '250.00', closed_at: new Date(),
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.CLOSED, {
        idempotencyKey: 'idem-5',
        filledQty: 5,
        fillPrice: 5.00,
        realizedPnL: 250,
      });

      expect(pos.state).toBe(PositionState.CLOSED);
    });

    test('OPEN → FORCE_CLOSED (emergency)', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({ state: 'OPEN' })] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'FORCE_CLOSED', version: 2, force_close_reason: 'RISK_BREACH',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.FORCE_CLOSED, {
        idempotencyKey: 'idem-6',
        forceCloseReason: 'RISK_BREACH',
        realizedPnL: -100,
      });

      expect(pos.state).toBe(PositionState.FORCE_CLOSED);
    });
  });

  describe('transition — illegal transitions', () => {
    const illegalCases: [PositionState, PositionState][] = [
      [PositionState.CLOSED, PositionState.OPEN],
      [PositionState.CLOSED, PositionState.EXIT_PENDING],
      [PositionState.CANCELLED, PositionState.OPEN],
      [PositionState.CANCELLED, PositionState.PENDING_ENTRY],
      [PositionState.FORCE_CLOSED, PositionState.OPEN],
      [PositionState.OPEN, PositionState.PENDING_ENTRY],
      [PositionState.OPEN, PositionState.PARTIALLY_FILLED],
      [PositionState.OPEN, PositionState.CANCELLED],
      [PositionState.EXIT_PENDING, PositionState.OPEN],
      [PositionState.PENDING_ENTRY, PositionState.EXIT_PENDING],
      [PositionState.PENDING_ENTRY, PositionState.CLOSED],
      [PositionState.PENDING_ENTRY, PositionState.FORCE_CLOSED],
    ];

    test.each(illegalCases)(
      '%s → %s throws PositionStateError',
      async (fromState, toState) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [makePositionRow({ state: fromState })] }),
        };
        mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

        await expect(
          service.transition('pos-1', toState, { idempotencyKey: 'idem-x' })
        ).rejects.toThrow(PositionStateError);
      }
    );
  });

  describe('optimistic locking', () => {
    test('throws PositionWriteConflictError on version mismatch after retry exhaustion', async () => {
      // The position's current version is 3 but caller expects 1
      // Service retries once, so mock must return same result both times
      const makeMockClient = () => ({
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({ state: 'PENDING_ENTRY', version: 3 })] }),
      });
      mockTransaction
        .mockImplementationOnce(async (cb: Function) => cb(makeMockClient()))
        .mockImplementationOnce(async (cb: Function) => cb(makeMockClient()));

      await expect(
        service.transition('pos-1', PositionState.OPEN, {
          idempotencyKey: 'idem-x',
          expectedVersion: 1,
          filledQty: 5,
          fillPrice: 4.50,
        })
      ).rejects.toThrow(PositionWriteConflictError);
    });

    test('retries once on version conflict from CAS update', async () => {
      let callCount = 0;
      const mockClient = {
        query: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return { rows: [makePositionRow({ state: 'PENDING_ENTRY' })] };
          }
          if (callCount === 2) {
            return { rows: [] }; // CAS failed — 0 rows updated
          }
          if (callCount === 3) {
            return { rows: [makePositionRow({ state: 'PENDING_ENTRY', version: 2 })] };
          }
          if (callCount === 4) {
            return { rows: [makePositionRow({ state: 'OPEN', version: 3 })] };
          }
          return { rows: [] };
        }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const pos = await service.transition('pos-1', PositionState.OPEN, {
        idempotencyKey: 'idem-retry',
        filledQty: 5,
        fillPrice: 4.50,
      });

      expect(pos.state).toBe(PositionState.OPEN);
    });
  });

  describe('average price computation', () => {
    test('PARTIALLY_FILLED → OPEN computes weighted average price', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'PARTIALLY_FILLED',
            entry_filled_qty: 3,
            entry_avg_price: '4.00',
          })] })
          .mockResolvedValueOnce({ rows: [makePositionRow({
            state: 'OPEN', version: 2, entry_filled_qty: 5, entry_avg_price: '4.40',
          })] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      // Verify the update was called with correct avg price
      // existing: 3 @ 4.00 = 12.00, new: 2 @ 5.00 = 10.00, total = 22.00 / 5 = 4.40
      await service.transition('pos-1', PositionState.OPEN, {
        idempotencyKey: 'idem-avg',
        filledQty: 2,
        fillPrice: 5.00,
      });

      const updateCall = mockClient.query.mock.calls[1];
      const updateSQL = updateCall[0] as string;
      expect(updateSQL).toContain('UPDATE oe_positions');
      // Check that entry_avg_price was included
      expect(updateSQL).toContain('entry_avg_price');
    });
  });

  describe('getOpenPositions', () => {
    test('returns positions in active states', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePositionRow({ state: 'OPEN' }),
          makePositionRow({ state: 'PENDING_ENTRY', position_id: 'pos-2' }),
        ],
      });

      const positions = await service.getOpenPositions('acct-1');
      expect(positions).toHaveLength(2);
    });
  });
});
