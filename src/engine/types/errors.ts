import { PositionState, RejectionCode, SystemState } from './enums.js';

export class OptionsEngineError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'OptionsEngineError';
    this.code = code;
    this.context = context;
  }
}

export class PositionStateError extends OptionsEngineError {
  public readonly fromState: PositionState;
  public readonly toState: PositionState;
  public readonly positionId: string;

  constructor(positionId: string, fromState: PositionState, toState: PositionState) {
    super(
      'ILLEGAL_POSITION_TRANSITION',
      `Illegal position state transition: ${fromState} → ${toState} for position ${positionId}`,
      { positionId, fromState, toState }
    );
    this.name = 'PositionStateError';
    this.positionId = positionId;
    this.fromState = fromState;
    this.toState = toState;
  }
}

export class LedgerLockTimeoutError extends OptionsEngineError {
  constructor(accountId: string, waitMs: number) {
    super(
      RejectionCode.LEDGER_LOCK_TIMEOUT,
      `Failed to acquire ledger lock for account ${accountId} within ${waitMs}ms`,
      { accountId, waitMs }
    );
    this.name = 'LedgerLockTimeoutError';
  }
}

export class InsufficientCapitalError extends OptionsEngineError {
  constructor(accountId: string, required: number, available: number) {
    super(
      RejectionCode.INSUFFICIENT_CAPITAL,
      `Insufficient capital for account ${accountId}: required=${required}, available=${available}`,
      { accountId, required, available }
    );
    this.name = 'InsufficientCapitalError';
  }
}

export class SystemNotActiveError extends OptionsEngineError {
  public readonly currentState: SystemState;

  constructor(currentState: SystemState) {
    super(
      RejectionCode.SYSTEM_NOT_ACTIVE,
      `System state is ${currentState}, entries are blocked`,
      { currentState }
    );
    this.name = 'SystemNotActiveError';
    this.currentState = currentState;
  }
}

export class LatencyBudgetExceededError extends OptionsEngineError {
  constructor(elapsedMs: number, budgetMs: number, mode: string) {
    super(
      RejectionCode.LATENCY_BUDGET_EXCEEDED,
      `Latency budget exceeded: ${elapsedMs}ms > ${budgetMs}ms (mode=${mode})`,
      { elapsedMs, budgetMs, mode }
    );
    this.name = 'LatencyBudgetExceededError';
  }
}

export class PositionWriteConflictError extends OptionsEngineError {
  constructor(positionId: string, expectedVersion: number, actualVersion: number) {
    super(
      RejectionCode.POSITION_WRITE_CONFLICT,
      `Optimistic lock conflict for position ${positionId}: expected v${expectedVersion}, got v${actualVersion}`,
      { positionId, expectedVersion, actualVersion }
    );
    this.name = 'PositionWriteConflictError';
  }
}

export class ConfigValidationError extends OptionsEngineError {
  constructor(errors: string[]) {
    super(
      'CONFIG_VALIDATION_FAILED',
      `Configuration validation failed: ${errors.join('; ')}`,
      { errors }
    );
    this.name = 'ConfigValidationError';
  }
}
