/**
 * Experiment Manager - Deterministic experiment creation and variant assignment
 *
 * Responsibilities:
 * - Generate deterministic assignment hashes
 * - Assign variants using a deterministic algorithm
 * - Create experiments idempotently
 */

import pg from 'pg';
import crypto from 'crypto';
import { Experiment, Signal } from './types.js';
import { ExperimentSchema } from './schemas.js';
import { logger } from '../utils/logger.js';

export class ExperimentManager {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Deterministic assignment hash based on signal_id and signal_hash
   */
  computeAssignmentHash(signal_id: string, signal_hash: string): string {
    const data = `${signal_id}:${signal_hash}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Deterministic variant assignment using modulo-based bucketing
   */
  getVariantAssignment(assignmentHash: string, splitPercentage: number = 0.5): 'A' | 'B' {
    const clampedSplit = Math.min(1, Math.max(0, splitPercentage));
    const bucket = BigInt(`0x${assignmentHash.slice(0, 16)}`) % 10000n;
    const threshold = BigInt(Math.round(clampedSplit * 10000));
    return bucket < threshold ? 'A' : 'B';
  }

  /**
   * Check if an experiment already exists for the signal
   */
  async experimentExists(signal_id: string): Promise<Experiment | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT experiment_id, signal_id, variant, assignment_hash, split_percentage, policy_version, created_at
         FROM experiments
         WHERE signal_id = $1`,
        [signal_id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.normalizeExperiment(result.rows[0]);
    } finally {
      client.release();
    }
  }

  /**
   * Create experiment idempotently (returns existing if present)
   */
  async createExperiment(
    signal: Signal,
    splitPercentage: number = 0.5,
    policyVersion: string = 'v1.0'
  ): Promise<Experiment> {
    const existing = await this.experimentExists(signal.signal_id);
    if (existing) {
      return existing;
    }

    const assignmentHash = this.computeAssignmentHash(signal.signal_id, signal.signal_hash);
    const variant = this.getVariantAssignment(assignmentHash, splitPercentage);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO experiments (signal_id, variant, assignment_hash, split_percentage, policy_version)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING experiment_id, signal_id, variant, assignment_hash, split_percentage, policy_version, created_at`,
        [signal.signal_id, variant, assignmentHash, splitPercentage, policyVersion]
      );

      const experiment = this.normalizeExperiment(result.rows[0]);

      logger.info('Created experiment', {
        experiment_id: experiment.experiment_id,
        signal_id: experiment.signal_id,
        variant: experiment.variant,
        assignment_hash: experiment.assignment_hash,
      });

      return experiment;
    } catch (error: any) {
      if (error?.code === '23505') {
        const retry = await this.experimentExists(signal.signal_id);
        if (retry) {
          return retry;
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private normalizeExperiment(row: any): Experiment {
    const normalized = {
      ...row,
      split_percentage: Number(row.split_percentage),
    };

    return ExperimentSchema.parse(normalized);
  }
}
