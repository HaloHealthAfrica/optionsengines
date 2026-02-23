import { LedgerTransactionType } from '../../engine/types/enums';
import { InsufficientCapitalError } from '../../engine/types/errors';

const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockLockAcquire = jest.fn();
const mockLockRelease = jest.fn();

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
jest.mock('../../engine/core/DistributedLock', () => ({
  distributedLock: {
    acquire: (...args: any[]) => mockLockAcquire(...args),
  },
}));
jest.mock('../../engine/core/GlobalSystemStateController', () => ({
  globalSystemState: {
    pause: jest.fn(),
    check: jest.fn().mockResolvedValue('ACTIVE'),
  },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    brokerSync: { warningThresholdPct: 0.01, freezeThresholdPct: 0.05 },
    timeouts: { lockAcquisitionMs: 500, lockTTLSeconds: 5 },
  }),
}));

import { AccountLedgerService } from '../../engine/core/AccountLedgerService';

describe('AccountLedgerService', () => {
  let ledger: AccountLedgerService;
  const accountId = '11111111-1111-1111-1111-111111111111';

  const mockLock = {
    key: `lock:account:${accountId}`,
    token: 'test-token',
    acquiredAt: Date.now(),
    release: mockLockRelease,
  };

  beforeEach(() => {
    ledger = new AccountLedgerService();
    mockQuery.mockReset();
    mockTransaction.mockReset();
    mockLockAcquire.mockReset();
    mockLockRelease.mockReset();
    mockLockAcquire.mockResolvedValue(mockLock);
    mockLockRelease.mockResolvedValue(true);
  });

  describe('getAccount', () => {
    test('returns mapped account when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: accountId,
          name: 'Test',
          initial_capital: '10000.00',
          current_cash: '10000.00',
          reserved_capital: '0.00',
          realized_pnl: '0.00',
          unrealized_pnl: '0.00',
          total_equity: '10000.00',
          max_daily_loss: '500.00',
          max_portfolio_risk: '5000.00',
          peak_equity: '10000.00',
          intraday_realized_pnl: '0.00',
          intraday_start_equity: '10000.00',
          entry_frozen: false,
          broker_sync_warning: false,
          broker_sync_frozen: false,
          broker_synced_at: null,
          created_at: new Date(),
        }],
      });

      const account = await ledger.getAccount(accountId);
      expect(account).not.toBeNull();
      expect(account!.currentCash).toBe(10000);
      expect(account!.reservedCapital).toBe(0);
      expect(account!.totalEquity).toBe(10000);
    });

    test('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const account = await ledger.getAccount(accountId);
      expect(account).toBeNull();
    });
  });

  describe('validateCapital', () => {
    test('returns sufficient=true when available >= required', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: accountId, name: 'Test', initial_capital: '10000.00',
          current_cash: '10000.00', reserved_capital: '2000.00',
          realized_pnl: '0.00', unrealized_pnl: '0.00', total_equity: '8000.00',
          max_daily_loss: '500.00', max_portfolio_risk: '5000.00',
          peak_equity: '10000.00', intraday_realized_pnl: '0.00',
          intraday_start_equity: '10000.00', entry_frozen: false,
          broker_sync_warning: false, broker_sync_frozen: false,
          broker_synced_at: null, created_at: new Date(),
        }],
      });

      const result = await ledger.validateCapital(accountId, 5000);
      expect(result.sufficient).toBe(true);
      expect(result.available).toBe(8000);
      expect(result.required).toBe(5000);
    });

    test('returns sufficient=false when available < required', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: accountId, name: 'Test', initial_capital: '10000.00',
          current_cash: '10000.00', reserved_capital: '8000.00',
          realized_pnl: '0.00', unrealized_pnl: '0.00', total_equity: '2000.00',
          max_daily_loss: '500.00', max_portfolio_risk: '5000.00',
          peak_equity: '10000.00', intraday_realized_pnl: '0.00',
          intraday_start_equity: '10000.00', entry_frozen: false,
          broker_sync_warning: false, broker_sync_frozen: false,
          broker_synced_at: null, created_at: new Date(),
        }],
      });

      const result = await ledger.validateCapital(accountId, 5000);
      expect(result.sufficient).toBe(false);
      expect(result.available).toBe(2000);
    });
  });

  describe('validateAndReserveCapital', () => {
    test('reserves capital and writes RESERVE ledger transaction', async () => {
      // Idempotency check — no existing
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: jest.fn()
          // SELECT FOR UPDATE
          .mockResolvedValueOnce({
            rows: [{
              id: accountId, current_cash: '10000.00', reserved_capital: '0.00',
              entry_frozen: false,
            }],
          })
          // INSERT ledger tx
          .mockResolvedValueOnce({ rows: [{ id: 'tx-id-1' }] })
          // UPDATE account
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const result = await ledger.validateAndReserveCapital(
        accountId, 500, 'ref-1', 'idempotency-1'
      );

      expect(result.success).toBe(true);
      expect(result.reservedAmount).toBe(500);
      expect(result.availableAfter).toBe(9500);
      expect(mockLockAcquire).toHaveBeenCalledWith(accountId);
      expect(mockLockRelease).toHaveBeenCalled();
    });

    test('throws InsufficientCapitalError when not enough capital', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({
            rows: [{
              id: accountId, current_cash: '1000.00', reserved_capital: '900.00',
              entry_frozen: false,
            }],
          }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      await expect(
        ledger.validateAndReserveCapital(accountId, 500, 'ref-1', 'idempotency-1')
      ).rejects.toThrow(InsufficientCapitalError);

      expect(mockLockRelease).toHaveBeenCalled();
    });

    test('idempotent — returns existing on duplicate key', async () => {
      mockQuery
        // Idempotency check finds existing
        .mockResolvedValueOnce({ rows: [{ id: 'existing-tx-id' }] })
        // getAccount for result
        .mockResolvedValueOnce({
          rows: [{
            id: accountId, name: 'Test', initial_capital: '10000.00',
            current_cash: '10000.00', reserved_capital: '500.00',
            realized_pnl: '0.00', unrealized_pnl: '0.00', total_equity: '9500.00',
            max_daily_loss: '500.00', max_portfolio_risk: '5000.00',
            peak_equity: '10000.00', intraday_realized_pnl: '0.00',
            intraday_start_equity: '10000.00', entry_frozen: false,
            broker_sync_warning: false, broker_sync_frozen: false,
            broker_synced_at: null, created_at: new Date(),
          }],
        });

      const result = await ledger.validateAndReserveCapital(
        accountId, 500, 'ref-1', 'idempotency-1'
      );

      expect(result.success).toBe(true);
      expect(result.reservationId).toBe('existing-tx-id');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    test('releases lock even on error', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockTransaction.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        ledger.validateAndReserveCapital(accountId, 500, 'ref-1', 'idempotency-1')
      ).rejects.toThrow('DB error');

      expect(mockLockRelease).toHaveBeenCalled();
    });
  });

  describe('commitEntry', () => {
    test('debits cash and reduces reservation on fill', async () => {
      // Idempotency check
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({
            rows: [{
              id: accountId, current_cash: '10000.00', reserved_capital: '500.00',
            }],
          })
          .mockResolvedValueOnce({
            rows: [{
              id: 'tx-commit', account_id: accountId, type: 'COMMIT_ENTRY',
              amount: '-500.00', reference_id: 'ref-1',
              balance_before: '10000.00', balance_after: '9500.00',
              notes: '', timestamp: new Date(), idempotency_key: 'idem-1',
            }],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const tx = await ledger.commitEntry(accountId, 500, 'ref-1', 'idem-1');
      expect(tx.type).toBe(LedgerTransactionType.COMMIT_ENTRY);
      expect(tx.amount).toBe(-500);
    });
  });

  describe('releaseCapital', () => {
    test('reduces reserved capital on cancel', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({
            rows: [{
              id: accountId, current_cash: '10000.00', reserved_capital: '500.00',
            }],
          })
          .mockResolvedValueOnce({
            rows: [{
              id: 'tx-release', account_id: accountId, type: 'RELEASE',
              amount: '500.00', reference_id: 'ref-1',
              balance_before: '10000.00', balance_after: '10000.00',
              notes: '', timestamp: new Date(), idempotency_key: 'idem-1',
            }],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const tx = await ledger.releaseCapital(accountId, 500, 'ref-1', 'idem-1');
      expect(tx.type).toBe(LedgerTransactionType.RELEASE);
    });
  });

  describe('realizePnL', () => {
    test('adds PnL to cash and realized totals', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({
            rows: [{
              id: accountId, current_cash: '9500.00', reserved_capital: '0.00',
              realized_pnl: '0.00', intraday_realized_pnl: '0.00',
            }],
          })
          .mockResolvedValueOnce({
            rows: [{
              id: 'tx-realize', account_id: accountId, type: 'REALIZE',
              amount: '250.00', reference_id: 'ref-1',
              balance_before: '9500.00', balance_after: '9750.00',
              notes: '', timestamp: new Date(), idempotency_key: 'idem-1',
            }],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (cb: Function) => cb(mockClient));

      const tx = await ledger.realizePnL(accountId, 250, 'ref-1', 'idem-1');
      expect(tx.type).toBe(LedgerTransactionType.REALIZE);
      expect(tx.amount).toBe(250);
    });
  });
});
