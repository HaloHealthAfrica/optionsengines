import { logger } from '../../utils/logger.js';

export type EngineName = 'entry-decision' | 'strike-selection' | 'exit-decision';

export interface AuditLogPayload {
  engine: EngineName;
  requestId: string;
  timestamp: number;
  input: unknown;
  output: unknown;
  metrics?: Record<string, unknown>;
  triggeredRules?: unknown[];
}

export function logAuditEvent(payload: AuditLogPayload): void {
  logger.info('Audit log', payload);
}
