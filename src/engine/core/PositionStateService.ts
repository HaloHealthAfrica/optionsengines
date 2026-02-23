import * as Sentry from '@sentry/node';
import { db } from '../../services/database.service.js';
import { logger } from '../../utils/logger.js';
import { PositionState, TradeStructure, LedgerTransactionType } from '../types/enums.js';
import {
  PositionStateError,
  PositionWriteConflictError,
  OptionsEngineError,
} from '../types/errors.js';
import type { Position } from '../types/index.js';

// ─── Legal Transition Table (from contract) ───

interface TransitionRule {
  to: PositionState;
  ledgerAction: LedgerTransactionType | null;
}

const LEGAL_TRANSITIONS: Record<PositionState, TransitionRule[]> = {
  [PositionState.PENDING_ENTRY]: [
    { to: PositionState.PARTIALLY_FILLED, ledgerAction: LedgerTransactionType.COMMIT_ENTRY },
    { to: PositionState.OPEN, ledgerAction: LedgerTransactionType.COMMIT_ENTRY },
    { to: PositionState.CANCELLED, ledgerAction: LedgerTransactionType.RELEASE },
  ],
  [PositionState.PARTIALLY_FILLED]: [
    { to: PositionState.OPEN, ledgerAction: LedgerTransactionType.COMMIT_ENTRY },
    { to: PositionState.CANCELLED, ledgerAction: LedgerTransactionType.RELEASE },
  ],
  [PositionState.OPEN]: [
    { to: PositionState.EXIT_PENDING, ledgerAction: null },
  ],
  [PositionState.EXIT_PENDING]: [
    { to: PositionState.CLOSED, ledgerAction: LedgerTransactionType.REALIZE },
  ],
  [PositionState.CLOSED]: [],
  [PositionState.FORCE_CLOSED]: [],
  [PositionState.CANCELLED]: [],
};

// OPEN can also transition to FORCE_CLOSED (emergency/risk)
LEGAL_TRANSITIONS[PositionState.OPEN].push(
  { to: PositionState.FORCE_CLOSED, ledgerAction: LedgerTransactionType.REALIZE }
);

export class PositionStateService {

  // ─── Create Position (initial state: PENDING_ENTRY) ───

  async createPosition(params: {
    accountId: string;
    tradePlanId: string;
    underlying: string;
    structure: TradeStructure;
    strategyTag: string;
    targetQty: number;
    entryOrderId: string;
    idempotencyKey: string;
  }): Promise<Position> {
    // Idempotency check
    const existing = await db.query(
      'SELECT * FROM oe_positions WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      logger.info('Create position idempotency hit', { idempotencyKey: params.idempotencyKey });
      return this.mapRow(existing.rows[0]);
    }

    const result = await db.query(
      `INSERT INTO oe_positions
        (account_id, trade_plan_id, underlying, structure, strategy_tag,
         state, entry_order_id, target_qty, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.accountId, params.tradePlanId, params.underlying,
        params.structure, params.strategyTag,
        PositionState.PENDING_ENTRY, params.entryOrderId,
        params.targetQty, params.idempotencyKey,
      ]
    );

    const position = this.mapRow(result.rows[0]);
    logger.info('Position created', {
      positionId: position.positionId,
      underlying: params.underlying,
      state: PositionState.PENDING_ENTRY,
    });
    return position;
  }

  // ─── Transition ───

  async transition(
    positionId: string,
    toState: PositionState,
    params: TransitionParams
  ): Promise<Position> {
    const maxRetries = 1;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await this.attemptTransition(positionId, toState, params);
      } catch (error) {
        if (error instanceof PositionWriteConflictError && attempt < maxRetries) {
          attempt++;
          logger.warn('Position version conflict, retrying', {
            positionId, attempt, toState,
          });
          continue;
        }
        if (error instanceof PositionWriteConflictError) {
          Sentry.captureException(error, { tags: { service: 'PositionStateService', op: 'transition' } });
        }
        throw error;
      }
    }

    // Unreachable, but TypeScript needs it
    throw new OptionsEngineError(
      'POSITION_TRANSITION_FAILED',
      `Failed to transition position ${positionId} after ${maxRetries + 1} attempts`,
      { positionId, toState }
    );
  }

  private async attemptTransition(
    positionId: string,
    toState: PositionState,
    params: TransitionParams
  ): Promise<Position> {
    return await db.transaction(async (client) => {
      // Read current position with row lock
      const posResult = await client.query(
        'SELECT * FROM oe_positions WHERE position_id = $1 FOR UPDATE',
        [positionId]
      );

      if (posResult.rows.length === 0) {
        throw new OptionsEngineError(
          'POSITION_NOT_FOUND',
          `Position ${positionId} not found`,
          { positionId }
        );
      }

      const current = this.mapRow(posResult.rows[0]);
      const fromState = current.state;

      // Validate transition is legal
      this.validateTransition(positionId, fromState, toState);

      // Optimistic version check
      if (params.expectedVersion !== undefined && current.version !== params.expectedVersion) {
        throw new PositionWriteConflictError(positionId, params.expectedVersion, current.version);
      }

      // Build update fields
      const updates = this.buildUpdateFields(fromState, toState, current, params);

      // Execute update with version increment
      const setClauses: string[] = [
        'state = $1',
        'version = version + 1',
        `idempotency_key = $2`,
      ];
      const values: unknown[] = [toState, params.idempotencyKey];
      let paramIdx = 3;

      for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }

      values.push(positionId);
      values.push(current.version);

      const updateResult = await client.query(
        `UPDATE oe_positions
         SET ${setClauses.join(', ')}
         WHERE position_id = $${paramIdx} AND version = $${paramIdx + 1}
         RETURNING *`,
        values
      );

      if (updateResult.rows.length === 0) {
        throw new PositionWriteConflictError(positionId, current.version, -1);
      }

      const updated = this.mapRow(updateResult.rows[0]);

      logger.info('Position state transitioned', {
        positionId,
        from: fromState,
        to: toState,
        version: updated.version,
      });

      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Position ${positionId} transitioned ${fromState} → ${toState}`,
        level: 'info',
        data: { positionId, from: fromState, to: toState, version: updated.version },
      });

      return updated;
    });
  }

  // ─── Transition Validation ───

  private validateTransition(positionId: string, from: PositionState, to: PositionState): void {
    const rules = LEGAL_TRANSITIONS[from];
    if (!rules || rules.length === 0) {
      throw new PositionStateError(positionId, from, to);
    }

    const isLegal = rules.some(r => r.to === to);
    if (!isLegal) {
      throw new PositionStateError(positionId, from, to);
    }
  }

  // ─── Build Update Fields ───

  private buildUpdateFields(
    _fromState: PositionState,
    toState: PositionState,
    current: Position,
    params: TransitionParams
  ): Record<string, unknown> {
    const updates: Record<string, unknown> = {};

    switch (toState) {
      case PositionState.PARTIALLY_FILLED: {
        if (params.filledQty === undefined || params.fillPrice === undefined) {
          throw new OptionsEngineError(
            'MISSING_FILL_DATA',
            'filledQty and fillPrice required for PARTIALLY_FILLED transition',
            { positionId: current.positionId }
          );
        }
        const totalFilled = current.entryFilledQty + params.filledQty;
        const avgPrice = this.computeAvgPrice(
          current.entryAvgPrice, current.entryFilledQty,
          params.fillPrice, params.filledQty
        );
        updates.entry_filled_qty = totalFilled;
        updates.entry_avg_price = avgPrice;
        break;
      }

      case PositionState.OPEN: {
        if (params.filledQty !== undefined && params.fillPrice !== undefined) {
          const totalFilled = current.entryFilledQty + params.filledQty;
          const avgPrice = this.computeAvgPrice(
            current.entryAvgPrice, current.entryFilledQty,
            params.fillPrice, params.filledQty
          );
          updates.entry_filled_qty = totalFilled;
          updates.entry_avg_price = avgPrice;
        }
        break;
      }

      case PositionState.EXIT_PENDING: {
        if (params.exitOrderId) {
          updates.exit_order_id = params.exitOrderId;
        }
        break;
      }

      case PositionState.CLOSED: {
        if (params.filledQty !== undefined) {
          updates.exit_filled_qty = current.exitFilledQty + params.filledQty;
        }
        if (params.fillPrice !== undefined) {
          updates.exit_avg_price = params.fillPrice;
        }
        if (params.realizedPnL !== undefined) {
          updates.realized_pnl = params.realizedPnL;
        }
        updates.closed_at = new Date();
        break;
      }

      case PositionState.FORCE_CLOSED: {
        if (params.fillPrice !== undefined) {
          updates.exit_avg_price = params.fillPrice;
        }
        if (params.realizedPnL !== undefined) {
          updates.realized_pnl = params.realizedPnL;
        }
        updates.force_close_reason = params.forceCloseReason ?? 'UNSPECIFIED';
        updates.closed_at = new Date();
        break;
      }

      case PositionState.CANCELLED: {
        updates.closed_at = new Date();
        break;
      }
    }

    return updates;
  }

  // ─── Partial Fill Average Price ───

  private computeAvgPrice(
    existingAvg: number | null,
    existingQty: number,
    newPrice: number,
    newQty: number
  ): number {
    if (existingQty === 0 || existingAvg === null) {
      return newPrice;
    }
    const totalCost = (existingAvg * existingQty) + (newPrice * newQty);
    const totalQty = existingQty + newQty;
    return totalCost / totalQty;
  }

  // ─── Queries ───

  async getPosition(positionId: string): Promise<Position | null> {
    const result = await db.query(
      'SELECT * FROM oe_positions WHERE position_id = $1',
      [positionId]
    );
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async getOpenPositions(accountId: string): Promise<Position[]> {
    const result = await db.query(
      `SELECT * FROM oe_positions
       WHERE account_id = $1 AND state IN ($2, $3, $4)
       ORDER BY opened_at DESC`,
      [accountId, PositionState.OPEN, PositionState.PENDING_ENTRY, PositionState.PARTIALLY_FILLED]
    );
    return result.rows.map(this.mapRow);
  }

  async getPositionsByUnderlying(accountId: string, underlying: string): Promise<Position[]> {
    const result = await db.query(
      `SELECT * FROM oe_positions
       WHERE account_id = $1 AND underlying = $2 AND state NOT IN ($3, $4, $5)
       ORDER BY opened_at DESC`,
      [accountId, underlying, PositionState.CLOSED, PositionState.FORCE_CLOSED, PositionState.CANCELLED]
    );
    return result.rows.map(this.mapRow);
  }

  async updateUnrealizedPnL(positionId: string, unrealizedPnL: number): Promise<void> {
    await db.query(
      'UPDATE oe_positions SET unrealized_pnl = $1 WHERE position_id = $2',
      [unrealizedPnL, positionId]
    );
  }

  // ─── Row Mapper ───

  private mapRow(row: any): Position {
    return {
      positionId: row.position_id,
      accountId: row.account_id,
      tradePlanId: row.trade_plan_id,
      underlying: row.underlying,
      structure: row.structure as TradeStructure,
      strategyTag: row.strategy_tag,
      state: row.state as PositionState,
      entryOrderId: row.entry_order_id,
      exitOrderId: row.exit_order_id,
      entryFilledQty: row.entry_filled_qty,
      exitFilledQty: row.exit_filled_qty,
      targetQty: row.target_qty,
      entryAvgPrice: row.entry_avg_price !== null ? parseFloat(row.entry_avg_price) : null,
      exitAvgPrice: row.exit_avg_price !== null ? parseFloat(row.exit_avg_price) : null,
      unrealizedPnL: parseFloat(row.unrealized_pnl),
      realizedPnL: row.realized_pnl !== null ? parseFloat(row.realized_pnl) : null,
      version: row.version,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      forceCloseReason: row.force_close_reason,
      idempotencyKey: row.idempotency_key,
    };
  }
}

export interface TransitionParams {
  idempotencyKey: string;
  expectedVersion?: number;
  filledQty?: number;
  fillPrice?: number;
  realizedPnL?: number;
  exitOrderId?: string;
  forceCloseReason?: string;
}

export const positionStateService = new PositionStateService();
