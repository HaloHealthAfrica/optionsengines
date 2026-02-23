import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { db } from '../../services/database.service.js';
import { logger } from '../../utils/logger.js';
import { distributedLock, type LockHandle } from './DistributedLock.js';
import { globalSystemState } from './GlobalSystemStateController.js';
import {
  LedgerTransactionType,
  SystemStateTransitionTrigger,
} from '../types/enums.js';
import {
  InsufficientCapitalError,
  OptionsEngineError,
} from '../types/errors.js';
import type {
  TradingAccount,
  LedgerTransaction,
  CapitalReservationResult,
  CapitalValidationResult,
} from '../types/index.js';

export class AccountLedgerService {

  // ─── Account CRUD ───

  async getAccount(accountId: string): Promise<TradingAccount | null> {
    const result = await db.query<TradingAccount>(
      'SELECT * FROM oe_trading_accounts WHERE id = $1',
      [accountId]
    );
    return result.rows[0] ? this.mapAccountRow(result.rows[0]) : null;
  }

  async createAccount(params: {
    name: string;
    initialCapital: number;
    maxDailyLoss: number;
    maxPortfolioRisk: number;
  }): Promise<TradingAccount> {
    const result = await db.query<TradingAccount>(
      `INSERT INTO oe_trading_accounts
        (name, initial_capital, current_cash, total_equity, max_daily_loss,
         max_portfolio_risk, peak_equity, intraday_start_equity)
       VALUES ($1, $2, $2, $2, $3, $4, $2, $2)
       RETURNING *`,
      [params.name, params.initialCapital, params.maxDailyLoss, params.maxPortfolioRisk]
    );

    const account = this.mapAccountRow(result.rows[0]);
    logger.info('Trading account created', { accountId: account.id, name: params.name });
    return account;
  }

  // ─── Capital Validation ───

  async validateCapital(accountId: string, required: number): Promise<CapitalValidationResult> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new OptionsEngineError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, { accountId });
    }

    const available = account.currentCash - account.reservedCapital;
    return {
      sufficient: available >= required,
      available,
      required,
      currentCash: account.currentCash,
      reservedCapital: account.reservedCapital,
    };
  }

  // ─── Reserve Capital (inside distributed lock) ───

  async validateAndReserveCapital(
    accountId: string,
    amount: number,
    referenceId: string,
    idempotencyKey: string
  ): Promise<CapitalReservationResult> {
    const lock = await distributedLock.acquire(accountId);
    try {
      return await this.reserveCapitalInLock(accountId, amount, referenceId, idempotencyKey, lock);
    } finally {
      await lock.release();
    }
  }

  private async reserveCapitalInLock(
    accountId: string,
    amount: number,
    referenceId: string,
    idempotencyKey: string,
    _lock: LockHandle
  ): Promise<CapitalReservationResult> {
    // Idempotency check
    const existing = await db.query(
      `SELECT id FROM oe_ledger_transactions
       WHERE idempotency_key = $1 AND type = $2`,
      [idempotencyKey, LedgerTransactionType.RESERVE]
    );
    if (existing.rows.length > 0) {
      logger.info('Reserve capital idempotency hit — returning existing', { idempotencyKey });
      const account = await this.getAccount(accountId);
      return {
        success: true,
        reservationId: existing.rows[0].id,
        reservedAmount: amount,
        availableAfter: account ? account.currentCash - account.reservedCapital : 0,
        ledgerTransactionId: existing.rows[0].id,
      };
    }

    return await db.transaction(async (client) => {
      // Re-read balances inside transaction with row lock
      const accountRow = await client.query(
        'SELECT * FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
        [accountId]
      );

      if (accountRow.rows.length === 0) {
        throw new OptionsEngineError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, { accountId });
      }

      const acct = accountRow.rows[0];
      const currentCash = parseFloat(acct.current_cash);
      const reservedCapital = parseFloat(acct.reserved_capital);
      const available = currentCash - reservedCapital;

      if (available < amount) {
        throw new InsufficientCapitalError(accountId, amount, available);
      }

      if (acct.entry_frozen) {
        throw new OptionsEngineError(
          'ACCOUNT_FROZEN',
          `Account ${accountId} has entries frozen`,
          { accountId }
        );
      }

      const newReserved = reservedCapital + amount;
      const balanceBefore = currentCash;
      const balanceAfter = currentCash; // cash doesn't change on reservation

      // Write ledger transaction
      const txResult = await client.query(
        `INSERT INTO oe_ledger_transactions
          (account_id, type, amount, reference_id, balance_before, balance_after, notes, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          accountId,
          LedgerTransactionType.RESERVE,
          amount,
          referenceId,
          balanceBefore,
          balanceAfter,
          `Reserve ${amount} for trade ${referenceId}`,
          idempotencyKey,
        ]
      );

      // Update account reserved capital
      await client.query(
        `UPDATE oe_trading_accounts
         SET reserved_capital = $1, total_equity = current_cash + realized_pnl + unrealized_pnl - $1
         WHERE id = $2`,
        [newReserved, accountId]
      );

      const availableAfter = currentCash - newReserved;
      logger.info('Capital reserved', {
        accountId,
        amount,
        reservedCapital: newReserved,
        availableAfter,
        referenceId,
      });

      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Capital reserved: ${amount} for ${referenceId}`,
        level: 'info',
        data: { accountId, amount, reservedCapital: newReserved, availableAfter },
      });

      return {
        success: true,
        reservationId: txResult.rows[0].id,
        reservedAmount: amount,
        availableAfter,
        ledgerTransactionId: txResult.rows[0].id,
      };
    });
  }

  // ─── Commit Entry (debit cash on fill) ───

  async commitEntry(
    accountId: string,
    amount: number,
    referenceId: string,
    idempotencyKey: string,
    reduceReservation: boolean = true
  ): Promise<LedgerTransaction> {
    const lock = await distributedLock.acquire(accountId);
    try {
      // Idempotency check
      const existing = await db.query(
        `SELECT * FROM oe_ledger_transactions
         WHERE idempotency_key = $1 AND type = $2`,
        [idempotencyKey, LedgerTransactionType.COMMIT_ENTRY]
      );
      if (existing.rows.length > 0) {
        logger.info('Commit entry idempotency hit', { idempotencyKey });
        return this.mapLedgerRow(existing.rows[0]);
      }

      return await db.transaction(async (client) => {
        const accountRow = await client.query(
          'SELECT * FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
          [accountId]
        );
        const acct = accountRow.rows[0];
        const currentCash = parseFloat(acct.current_cash);
        const reservedCapital = parseFloat(acct.reserved_capital);

        const newCash = currentCash - amount;
        const newReserved = reduceReservation
          ? Math.max(0, reservedCapital - amount)
          : reservedCapital;

        const txResult = await client.query(
          `INSERT INTO oe_ledger_transactions
            (account_id, type, amount, reference_id, balance_before, balance_after, notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            accountId,
            LedgerTransactionType.COMMIT_ENTRY,
            -amount,
            referenceId,
            currentCash,
            newCash,
            `Commit entry ${amount} for ${referenceId}`,
            idempotencyKey,
          ]
        );

        await client.query(
          `UPDATE oe_trading_accounts
           SET current_cash = $1,
               reserved_capital = $2,
               total_equity = $1 + realized_pnl + unrealized_pnl - $2
           WHERE id = $3`,
          [newCash, newReserved, accountId]
        );

        logger.info('Entry committed', { accountId, amount, newCash, referenceId });
        Sentry.addBreadcrumb({
          category: 'engine',
          message: `Entry committed: ${amount} for ${referenceId}`,
          level: 'info',
          data: { accountId, amount, newCash },
        });
        return this.mapLedgerRow(txResult.rows[0]);
      });
    } finally {
      await lock.release();
    }
  }

  // ─── Release Reserved Capital (on cancel/close) ───

  async releaseCapital(
    accountId: string,
    amount: number,
    referenceId: string,
    idempotencyKey: string
  ): Promise<LedgerTransaction> {
    const lock = await distributedLock.acquire(accountId);
    try {
      const existing = await db.query(
        `SELECT * FROM oe_ledger_transactions
         WHERE idempotency_key = $1 AND type = $2`,
        [idempotencyKey, LedgerTransactionType.RELEASE]
      );
      if (existing.rows.length > 0) {
        logger.info('Release capital idempotency hit', { idempotencyKey });
        return this.mapLedgerRow(existing.rows[0]);
      }

      return await db.transaction(async (client) => {
        const accountRow = await client.query(
          'SELECT * FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
          [accountId]
        );
        const acct = accountRow.rows[0];
        const currentCash = parseFloat(acct.current_cash);
        const reservedCapital = parseFloat(acct.reserved_capital);

        const newReserved = Math.max(0, reservedCapital - amount);

        const txResult = await client.query(
          `INSERT INTO oe_ledger_transactions
            (account_id, type, amount, reference_id, balance_before, balance_after, notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            accountId,
            LedgerTransactionType.RELEASE,
            amount,
            referenceId,
            currentCash,
            currentCash,
            `Release reservation ${amount} for ${referenceId}`,
            idempotencyKey,
          ]
        );

        await client.query(
          `UPDATE oe_trading_accounts
           SET reserved_capital = $1,
               total_equity = current_cash + realized_pnl + unrealized_pnl - $1
           WHERE id = $2`,
          [newReserved, accountId]
        );

        logger.info('Capital released', { accountId, amount, newReserved, referenceId });
        Sentry.addBreadcrumb({
          category: 'engine',
          message: `Capital released: ${amount} for ${referenceId}`,
          level: 'info',
          data: { accountId, amount, newReserved },
        });
        return this.mapLedgerRow(txResult.rows[0]);
      });
    } finally {
      await lock.release();
    }
  }

  // ─── Realize PnL (on position close) ───

  async realizePnL(
    accountId: string,
    pnl: number,
    referenceId: string,
    idempotencyKey: string,
    releaseMargin: number = 0
  ): Promise<LedgerTransaction> {
    const lock = await distributedLock.acquire(accountId);
    try {
      const existing = await db.query(
        `SELECT * FROM oe_ledger_transactions
         WHERE idempotency_key = $1 AND type = $2`,
        [idempotencyKey, LedgerTransactionType.REALIZE]
      );
      if (existing.rows.length > 0) {
        logger.info('Realize PnL idempotency hit', { idempotencyKey });
        return this.mapLedgerRow(existing.rows[0]);
      }

      return await db.transaction(async (client) => {
        const accountRow = await client.query(
          'SELECT * FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
          [accountId]
        );
        const acct = accountRow.rows[0];
        const currentCash = parseFloat(acct.current_cash);
        const realizedPnL = parseFloat(acct.realized_pnl);
        const reservedCapital = parseFloat(acct.reserved_capital);
        const intradayRealized = parseFloat(acct.intraday_realized_pnl);

        const newCash = currentCash + pnl;
        const newRealized = realizedPnL + pnl;
        const newIntraday = intradayRealized + pnl;
        const newReserved = Math.max(0, reservedCapital - releaseMargin);

        const txResult = await client.query(
          `INSERT INTO oe_ledger_transactions
            (account_id, type, amount, reference_id, balance_before, balance_after, notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            accountId,
            LedgerTransactionType.REALIZE,
            pnl,
            referenceId,
            currentCash,
            newCash,
            `Realize PnL ${pnl} for ${referenceId}`,
            idempotencyKey,
          ]
        );

        await client.query(
          `UPDATE oe_trading_accounts
           SET current_cash = $1,
               realized_pnl = $2,
               intraday_realized_pnl = $3,
               reserved_capital = $4,
               peak_equity = GREATEST(peak_equity, $1 + $2 + unrealized_pnl - $4),
               total_equity = $1 + $2 + unrealized_pnl - $4
           WHERE id = $5`,
          [newCash, newRealized, newIntraday, newReserved, accountId]
        );

        logger.info('PnL realized', { accountId, pnl, newCash, newRealized, referenceId });
        Sentry.addBreadcrumb({
          category: 'engine',
          message: `PnL realized: ${pnl} for ${referenceId}`,
          level: 'info',
          data: { accountId, pnl, newCash, newRealized },
        });
        return this.mapLedgerRow(txResult.rows[0]);
      });
    } finally {
      await lock.release();
    }
  }

  // ─── MTM Update (mark-to-market) ───

  async updateMTM(
    accountId: string,
    newUnrealizedPnL: number,
    idempotencyKey: string
  ): Promise<void> {
    const lock = await distributedLock.acquire(accountId);
    try {
      const existing = await db.query(
        `SELECT id FROM oe_ledger_transactions
         WHERE idempotency_key = $1 AND type = $2`,
        [idempotencyKey, LedgerTransactionType.MTM_UPDATE]
      );
      if (existing.rows.length > 0) return;

      await db.transaction(async (client) => {
        const accountRow = await client.query(
          'SELECT * FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
          [accountId]
        );
        const acct = accountRow.rows[0];
        const currentCash = parseFloat(acct.current_cash);
        const realizedPnL = parseFloat(acct.realized_pnl);
        const reservedCapital = parseFloat(acct.reserved_capital);
        const oldUnrealized = parseFloat(acct.unrealized_pnl);

        const newEquity = currentCash + realizedPnL + newUnrealizedPnL - reservedCapital;

        await client.query(
          `INSERT INTO oe_ledger_transactions
            (account_id, type, amount, balance_before, balance_after, notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            accountId,
            LedgerTransactionType.MTM_UPDATE,
            newUnrealizedPnL - oldUnrealized,
            currentCash,
            currentCash,
            `MTM update: unrealized ${oldUnrealized} → ${newUnrealizedPnL}`,
            idempotencyKey,
          ]
        );

        await client.query(
          `UPDATE oe_trading_accounts
           SET unrealized_pnl = $1,
               total_equity = $2,
               peak_equity = GREATEST(peak_equity, $2)
           WHERE id = $3`,
          [newUnrealizedPnL, newEquity, accountId]
        );
      });
    } finally {
      await lock.release();
    }
  }

  // ─── Broker Sync (equity comparison) ───

  async brokerSyncCheck(
    accountId: string,
    brokerEquity: number
  ): Promise<{ warning: boolean; frozen: boolean; drift: number; driftPct: number }> {
    const lock = await distributedLock.acquire(accountId);
    try {
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new OptionsEngineError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, { accountId });
      }

      const drift = Math.abs(brokerEquity - account.totalEquity);
      const driftPct = account.totalEquity !== 0
        ? drift / Math.abs(account.totalEquity)
        : drift > 0 ? 1 : 0;

      const { getEngineConfig } = await import('../config/loader.js');
      const cfg = getEngineConfig();

      const warning = driftPct > cfg.brokerSync.warningThresholdPct;
      const frozen = driftPct > cfg.brokerSync.freezeThresholdPct;

      const idempotencyKey = randomUUID();
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO oe_ledger_transactions
            (account_id, type, amount, balance_before, balance_after, notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            accountId,
            LedgerTransactionType.BROKER_SYNC,
            drift,
            account.totalEquity,
            brokerEquity,
            `Broker sync: local=${account.totalEquity}, broker=${brokerEquity}, drift=${driftPct.toFixed(4)}`,
            idempotencyKey,
          ]
        );

        await client.query(
          `UPDATE oe_trading_accounts
           SET broker_sync_warning = $1,
               broker_sync_frozen = $2,
               broker_synced_at = NOW(),
               entry_frozen = CASE WHEN $2 THEN TRUE ELSE entry_frozen END
           WHERE id = $3`,
          [warning, frozen, accountId]
        );
      });

      if (frozen) {
        logger.warn('Broker sync freeze triggered', { accountId, driftPct, drift });
        Sentry.captureMessage('Broker sync freeze triggered', {
          level: 'error',
          tags: { service: 'AccountLedgerService', op: 'brokerSyncCheck' },
          extra: { accountId, drift, driftPct, brokerEquity, localEquity: account.totalEquity },
        });
        await globalSystemState.pause(
          SystemStateTransitionTrigger.BROKER_SYNC_FREEZE,
          'AccountLedgerService',
          `Broker equity drift ${(driftPct * 100).toFixed(2)}% exceeds freeze threshold`,
          { accountId, drift, driftPct, brokerEquity, localEquity: account.totalEquity }
        );
      } else if (warning) {
        logger.warn('Broker sync warning', { accountId, driftPct, drift });
      }

      return { warning, frozen, drift, driftPct };
    } finally {
      await lock.release();
    }
  }

  // ─── Drawdown Check ───

  async getDrawdownState(accountId: string): Promise<{
    drawdownPct: number;
    intradayRealizedPnL: number;
    maxDailyLoss: number;
  }> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new OptionsEngineError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, { accountId });
    }

    const drawdownPct = account.maxDailyLoss !== 0
      ? Math.abs(account.intradayRealizedPnL) / Math.abs(account.maxDailyLoss)
      : 0;

    return {
      drawdownPct,
      intradayRealizedPnL: account.intradayRealizedPnL,
      maxDailyLoss: account.maxDailyLoss,
    };
  }

  // ─── Intraday Reset ───

  async resetIntradayCounters(accountId: string): Promise<void> {
    const lock = await distributedLock.acquire(accountId);
    try {
      await db.transaction(async (client) => {
        const accountRow = await client.query(
          'SELECT total_equity FROM oe_trading_accounts WHERE id = $1 FOR UPDATE',
          [accountId]
        );
        const equity = parseFloat(accountRow.rows[0].total_equity);

        await client.query(
          `UPDATE oe_trading_accounts
           SET intraday_realized_pnl = 0,
               intraday_start_equity = $1,
               entry_frozen = FALSE,
               broker_sync_warning = FALSE,
               broker_sync_frozen = FALSE
           WHERE id = $2`,
          [equity, accountId]
        );
      });

      logger.info('Intraday counters reset', { accountId });
    } finally {
      await lock.release();
    }
  }

  // ─── Ledger History ───

  async getLedgerHistory(
    accountId: string,
    limit: number = 100
  ): Promise<LedgerTransaction[]> {
    const result = await db.query(
      `SELECT * FROM oe_ledger_transactions
       WHERE account_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [accountId, limit]
    );
    return result.rows.map(this.mapLedgerRow);
  }

  // ─── Row Mappers ───

  private mapAccountRow(row: any): TradingAccount {
    return {
      id: row.id,
      name: row.name,
      initialCapital: parseFloat(row.initial_capital),
      currentCash: parseFloat(row.current_cash),
      reservedCapital: parseFloat(row.reserved_capital),
      realizedPnL: parseFloat(row.realized_pnl),
      unrealizedPnL: parseFloat(row.unrealized_pnl),
      totalEquity: parseFloat(row.total_equity),
      maxDailyLoss: parseFloat(row.max_daily_loss),
      maxPortfolioRisk: parseFloat(row.max_portfolio_risk),
      peakEquity: parseFloat(row.peak_equity),
      intradayRealizedPnL: parseFloat(row.intraday_realized_pnl),
      intradayStartEquity: parseFloat(row.intraday_start_equity),
      entryFrozen: row.entry_frozen,
      brokerSyncWarning: row.broker_sync_warning,
      brokerSyncFrozen: row.broker_sync_frozen,
      brokerSyncedAt: row.broker_synced_at,
      createdAt: row.created_at,
    };
  }

  private mapLedgerRow(row: any): LedgerTransaction {
    return {
      id: row.id,
      accountId: row.account_id,
      type: row.type as LedgerTransactionType,
      amount: parseFloat(row.amount),
      referenceId: row.reference_id,
      balanceBefore: parseFloat(row.balance_before),
      balanceAfter: parseFloat(row.balance_after),
      notes: row.notes,
      timestamp: row.timestamp,
      idempotencyKey: row.idempotency_key,
    };
  }
}

export const accountLedger = new AccountLedgerService();
